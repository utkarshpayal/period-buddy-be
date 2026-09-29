import { describeAccess, isStaffRole } from '../config/permissions.js';
import User from '../models/User.js';
import PendingSignup from '../models/PendingSignup.js';
import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import Habit from '../models/Habit.js';
import { comparePassword, hashPassword } from '../utils/password.js';
import { generateToken } from '../utils/jwt.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { ERROR_MESSAGES, SUCCESS_MESSAGES } from '../constants/errorMessages.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { pickDefined, todayDateKey } from '../utils/apiHelpers.js';
import { computeCyclePredictions, calculateTrackingStreak } from '../utils/cycle.js';
import { userRoleEnum } from '../enums/enums.js';
import {
  generateOtp,
  hashOtp,
  compareOtp,
  getOtpExpiry,
  OTP_EXPIRY_MINUTES,
  OTP_RESEND_COOLDOWN_SECONDS,
  OTP_MAX_ATTEMPTS,
} from '../utils/otp.js';
import { sendMail } from '../utils/mailer.js';
import {
  getOtpEmailTemplate,
  getAccountDeletionOtpEmailTemplate,
} from '../templates/emailTemplates.js';
import { verifyGoogleIdToken } from '../utils/googleAuth.js';
import logger from '../utils/logger.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { buildLogoutTokenFilter } from '../utils/logoutToken.js';
import {
  isSuspended,
  notifySuspendedLoginAttempt,
  sendAccountSuspendedError,
} from '../utils/accountStatus.js';
import {
  findAccountsByOriginalEmail,
  isSelfDeletionBlocked,
  purgeAccount,
  softDeleteAccount,
} from '../utils/accountLifecycle.js';

const sendOtpEmail = async ({ email, firstName, otp }) => {
  await sendMail({
    to: email,
    subject: 'Your Nura verification code',
    html: getOtpEmailTemplate({ firstName, otp, expiryMinutes: OTP_EXPIRY_MINUTES }),
  });
};

/**
 * User Signup Controller — stores the signup data + a hashed OTP in
 * PendingSignup and emails the code. The User document is only created once
 * verifyOtp succeeds (see below), so no account exists until validation.
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const signup = async (req, res, next) => {
  try {
    const { firstName, lastName, email, password, phone, dateOfBirth, gender, role } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();

    // Check if a verified user already exists
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      return sendError(res, HTTP_STATUS.CONFLICT, ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
    }

    const otp = generateOtp();
    const otpHash = await hashOtp(otp);
    const hashedPassword = await hashPassword(password);

    await PendingSignup.findOneAndUpdate(
      { email: normalizedEmail },
      {
        email: normalizedEmail,
        firstName,
        lastName: lastName || '',
        password: hashedPassword,
        phone,
        dateOfBirth,
        gender,
        role: role || 'user',
        otpHash,
        otpExpiresAt: getOtpExpiry(),
        otpAttempts: 0,
        lastSentAt: new Date(),
      },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );

    await sendOtpEmail({ email: normalizedEmail, firstName, otp });

    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.OTP_SENT, {
      email: normalizedEmail,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Verifies the OTP for a pending signup and creates the real User account.
 */
export const verifyOtp = async (req, res, next) => {
  try {
    const { email, otp } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();

    const pending = await PendingSignup.findOne({ email: normalizedEmail });
    if (!pending) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.OTP_NOT_FOUND);
    }

    if (pending.otpExpiresAt < new Date()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.OTP_EXPIRED);
    }

    if (pending.otpAttempts >= OTP_MAX_ATTEMPTS) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.OTP_MAX_ATTEMPTS);
    }

    const isValid = await compareOtp(String(otp), pending.otpHash);
    if (!isValid) {
      pending.otpAttempts += 1;
      await pending.save();
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.OTP_INVALID);
    }

    // Someone may have raced this signup between two verification attempts.
    const existingUser = await User.findOne({ email: normalizedEmail });
    if (existingUser) {
      await PendingSignup.deleteOne({ _id: pending._id });
      return sendError(res, HTTP_STATUS.CONFLICT, ERROR_MESSAGES.EMAIL_ALREADY_EXISTS);
    }

    const user = new User({
      firstName: pending.firstName,
      lastName: pending.lastName,
      email: pending.email,
      password: pending.password, // already hashed — bypass the pre-save hook
      phone: pending.phone,
      dateOfBirth: pending.dateOfBirth,
      gender: pending.gender,
      role: pending.role || userRoleEnum.USER,
      isEmailVerified: true,
    });
    // Password is already hashed (it came from PendingSignup) — skip the
    // model's pre-save hashing hook so it isn't hashed a second time.
    user.$locals.skipPasswordHash = true;
    await user.save();

    await PendingSignup.deleteOne({ _id: pending._id });

    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
    });

    return sendResponse(
      res,
      HTTP_STATUS.CREATED,
      SUCCESS_MESSAGES.OTP_VERIFIED,
      user.toJSON(),
      token,
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Resends a fresh OTP for a pending signup, subject to a short cooldown.
 */
export const resendOtp = async (req, res, next) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();

    const pending = await PendingSignup.findOne({ email: normalizedEmail });
    if (!pending) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.OTP_NOT_FOUND);
    }

    const secondsSinceLastSend = (Date.now() - pending.lastSentAt.getTime()) / 1000;
    if (secondsSinceLastSend < OTP_RESEND_COOLDOWN_SECONDS) {
      return sendError(res, HTTP_STATUS.TOO_MANY_REQUESTS, ERROR_MESSAGES.OTP_RESEND_TOO_SOON);
    }

    const otp = generateOtp();
    pending.otpHash = await hashOtp(otp);
    pending.otpExpiresAt = getOtpExpiry();
    pending.otpAttempts = 0;
    pending.lastSentAt = new Date();
    await pending.save();

    await sendOtpEmail({ email: normalizedEmail, firstName: pending.firstName, otp });

    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.OTP_RESENT, {
      email: normalizedEmail,
      expiresInMinutes: OTP_EXPIRY_MINUTES,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * User Login Controller
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Find user by email and include password field
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Google-only accounts have no password — send them back to Google sign-in
    // instead of letting bcrypt.compare blow up on an undefined hash.
    if (!user.password) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.GOOGLE_ONLY_ACCOUNT);
    }

    // Compare passwords
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Checked only after the password matches, so this can't be used to
    // probe which emails belong to suspended accounts (or to trigger the
    // notice email for someone else's account).
    if (isSuspended(user)) {
      notifySuspendedLoginAttempt(user);
      return sendAccountSuspendedError(res);
    }
    if (!user.isActive) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.INVALID_CREDENTIALS);
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    // Generate token
    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
    });

    // Get user data without password. Staff also get their workspace access
    // (role label, department, permissions) so the Admin Workspace can build
    // its navigation without a second round trip.
    const userData = user.toJSON();
    if (isStaffRole(user.role)) userData.access = describeAccess(user.role);

    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.LOGIN_SUCCESS, userData, token);
  } catch (error) {
    next(error);
  }
};

/**
 * Google Sign-In — verifies the ID token the client got from Google, then
 * either logs in the matching account or creates a new one (skipping the
 * OTP flow entirely, since Google has already verified the email).
 */
export const googleAuth = async (req, res, next) => {
  try {
    const { idToken, role } = req.body;

    const payload = await verifyGoogleIdToken(idToken);
    const {
      sub: googleId,
      email,
      given_name: givenName,
      family_name: familyName,
      picture,
      email_verified: emailVerified,
    } = payload;

    if (!email) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.GOOGLE_EMAIL_MISSING);
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    let user = await User.findOne({ $or: [{ googleId }, { email: normalizedEmail }] });

    if (user) {
      // The Google ID token is already verified, so the caller owns this
      // email — safe to say it's suspended and send the notice.
      if (isSuspended(user)) {
        notifySuspendedLoginAttempt(user);
        return sendAccountSuspendedError(res);
      }
      if (!user.isActive) {
        return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Your account is inactive');
      }

      // A local account signing in with Google for the first time — link it
      // rather than creating a duplicate account for the same email.
      let didChange = false;
      if (!user.googleId) {
        user.googleId = googleId;
        didChange = true;
      }
      if (!user.isEmailVerified && emailVerified) {
        user.isEmailVerified = true;
        didChange = true;
      }
      if (!user.profilePicture && picture) {
        user.profilePicture = picture;
        didChange = true;
      }
      user.lastLogin = new Date();
      didChange = true;
      if (didChange) await user.save();
    } else {
      // firstName requires a 2-char minimum — Google occasionally supplies a
      // single-character given name (or none at all). lastName is optional.
      user = new User({
        firstName: givenName && givenName.trim().length >= 2 ? givenName.trim() : 'Nura',
        lastName: familyName?.trim() || '',
        email: normalizedEmail,
        googleId,
        authProvider: 'google',
        profilePicture: picture,
        isEmailVerified: Boolean(emailVerified),
        role: role && ['user', 'partner'].includes(role) ? role : userRoleEnum.USER,
        lastLogin: new Date(),
      });
      await user.save();
    }

    const token = generateToken({
      userId: user._id,
      email: user.email,
      role: user.role,
    });

    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.LOGIN_SUCCESS, user.toJSON(), token);
  } catch (error) {
    if (
      error.message?.includes('Invalid or expired Google') ||
      error.message?.includes('not configured')
    ) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, error.message);
    }
    next(error);
  }
};

// One-time wallet bonus for finishing onboarding — the only tokens a fresh
// account should have until the user actually logs something.
const PROFILE_COMPLETE_BONUS = 20;

export const onboarding = async (req, res, next) => {
  try {
    const { dateOfBirth, gender, phone, profilePicture, state } = req.body;

    const existingUser = await User.findById(req.userId);
    if (!existingUser) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const isFirstCompletion = !existingUser.isProfileComplete;

    const updates = {
      isProfileComplete: true,
      ...pickDefined({ dateOfBirth, gender, phone, profilePicture, state }, [
        'dateOfBirth',
        'gender',
        'phone',
        'profilePicture',
        'state',
      ]),
      ...(isFirstCompletion && {
        walletBalance: (existingUser.walletBalance || 0) + PROFILE_COMPLETE_BONUS,
      }),
    };

    const updatedUser = await User.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    });

    if (!updatedUser) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.ONBOARDING_COMPLETE, updatedUser);
  } catch (error) {
    next(error);
  }
};

/**
 * Get Current User Profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId);

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.PROFILE_FETCHED, user.toJSON());
  } catch (error) {
    next(error);
  }
};

/**
 * Update User Profile
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const updateProfile = async (req, res, next) => {
  try {
    const updates = pickDefined(req.body, [
      'firstName',
      'lastName',
      'phone',
      'dateOfBirth',
      'gender',
      'profilePicture',
      'state',
      'notificationsEnabled',
      'anonymousCommunityMode',
    ]);

    const user = await User.findByIdAndUpdate(req.userId, updates, {
      new: true,
      runValidators: true,
    });

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Profile updated successfully', user.toJSON());
  } catch (error) {
    next(error);
  }
};

/**
 * Change Password
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const changePassword = async (req, res, next) => {
  try {
    const { currentPassword, newPassword } = req.body;

    const user = await User.findById(req.userId).select('+password');

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Verify current password
    const isPasswordValid = await comparePassword(currentPassword, user.password);

    if (!isPasswordValid) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Current password is incorrect');
    }

    // Update password
    user.password = newPassword;
    await user.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Password changed successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Logout (Client-side mainly, but can be used for token blacklist if needed)
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const logout = async (req, res, next) => {
  try {
    // In a real application, you might want to implement token blacklisting.
    // Drop this device's push token so a logged-out phone stops receiving
    // this account's notifications (period reminders, partner updates, ...).
    // With `fcmToken` in the body, only clear it if it's still this device's
    // (another phone may have registered since); without it (older app
    // builds), clear unconditionally. See utils/logoutToken.js.
    // Best-effort: a failure here must never make logout itself fail.
    const filter = buildLogoutTokenFilter(req.userId, req.body);
    if (filter) {
      try {
        await User.updateOne(filter, { $unset: { notificationToken: 1 } });
      } catch (err) {
        logger.warn('logout_token_unset_failed', { userId: req.userId, error: err?.message });
      }
    }
    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.LOGOUT_SUCCESS);
  } catch (error) {
    next(error);
  }
};

/**
 * Delete User Account
 * @param {Object} req - Express request object
 * @param {Object} res - Express response object
 */
export const deleteAccount = async (req, res, next) => {
  try {
    const { password } = req.body;

    const user = await User.findById(req.userId).select('+password');

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Verify password before deletion
    const isPasswordValid = await comparePassword(password, user.password);

    if (!isPasswordValid) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Password is incorrect');
    }

    if (isSelfDeletionBlocked(user)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, SELF_DELETION_BLOCKED_MESSAGE);
    }

    // Soft delete: the row stays (so the public purge can still find it),
    // but posts are hidden and every partner/buddy/community link, push
    // token, reminder and check-in call is torn down — utils/accountLifecycle.js.
    await softDeleteAccount(user);

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.ACCOUNT_DELETED,
      resourceType: 'user',
      resourceId: user._id,
      metadata: { mode: 'authenticated' },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Account deleted successfully');
  } catch (error) {
    next(error);
  }
};

/**
 * Home/dashboard summary used by the Period Buddy landing dashboard.
 */
export const getDashboardSummary = async (req, res, next) => {
  try {
    const [user, settings, logs, habits] = await Promise.all([
      User.findById(req.userId),
      CycleSettings.findOne({ userId: req.userId }),
      CycleLog.find({ userId: req.userId }).sort({ dateKey: -1 }).limit(90),
      Habit.find({ userId: req.userId, isActive: true }),
    ]);

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    const trackedDays = logs.filter(
      (log) =>
        log.note?.trim() || (log.symptoms || []).length > 0 || (log.flow && log.flow !== 'none'),
    ).length;

    // A brand-new account has no logs yet — leave the default streakCount (1,
    // for "day one") alone until real tracking activity exists to derive from.
    if (logs.length > 0) {
      const currentStreak = calculateTrackingStreak(logs);
      if (user.streakCount !== currentStreak) {
        user.streakCount = currentStreak;
        await user.save();
      }
    }

    const today = todayDateKey();
    const completedHabitsToday = habits.filter((habit) =>
      habit.completedDates?.includes(today),
    ).length;
    const forestHealth = Math.min(
      100,
      Math.max(45, 55 + trackedDays * 4 + completedHabitsToday * 2),
    );
    const predictions = settings ? computeCyclePredictions(settings) : null;

    return sendResponse(res, HTTP_STATUS.OK, 'Dashboard summary fetched', {
      user: user.toJSON(),
      tokens: user.walletBalance || 0,
      trackedDays,
      forestHealth,
      activeHabits: habits.length,
      predictions,
      recentLogs: logs.slice(0, 7),
    });
  } catch (error) {
    next(error);
  }
};

export const updateFcmToken = async (req, res, next) => {
  try {
    const token = typeof req.body.token === 'string' ? req.body.token.trim() : '';
    if (!token) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Token is required');
    }

    // A device token belongs to one install. If another account previously
    // signed in on this phone (and was never logged out server-side, e.g. a
    // session that just expired), it would otherwise keep receiving that
    // account's pushes here.
    await User.updateMany(
      { _id: { $ne: req.userId }, notificationToken: token },
      { $unset: { notificationToken: 1 } },
    );

    const user = await User.findByIdAndUpdate(
      req.userId,
      { notificationToken: token },
      { new: true },
    );

    if (!user) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    logger.info('fcm_token_updated', { userId: req.userId, token });

    return sendResponse(res, HTTP_STATUS.OK, 'FCM token updated successfully', {
      notificationToken: user.notificationToken,
    });
  } catch (error) {
    next(error);
  }
};

const SELF_DELETE_RESEND_COOLDOWN_SECONDS = OTP_RESEND_COOLDOWN_SECONDS;

const SELF_DELETION_BLOCKED_MESSAGE =
  'Workspace and clinician accounts are removed by an administrator. Please contact support.';

/**
 * Self-service deletion, step 1 — public/unauthenticated (used by the
 * marketing site's unlisted "delete my data" page). Requesting a code never
 * reveals whether the email has an account: same response either way, and
 * the email itself is only sent if it does. This is deliberate — an
 * unauthenticated endpoint that confirms account existence is an enumeration
 * leak, and the page it backs is reachable by anyone who finds the URL.
 */
export const requestSelfDeletion = async (req, res, next) => {
  try {
    const { email } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();
    const genericResponse = () =>
      sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.SELF_DELETE_OTP_SENT, {
        email: normalizedEmail,
        expiresInMinutes: OTP_EXPIRY_MINUTES,
      });

    // The live account plus any the owner already deleted in the app (those
    // are renamed to deleted_<id>_<email> but still hold their data until
    // purged here). Staff/clinician accounts are silently skipped — same
    // response either way, so this can't be used to probe roles.
    const accounts = (
      await findAccountsByOriginalEmail(normalizedEmail, '+selfDeleteLastSentAt role')
    ).filter((account) => !isSelfDeletionBlocked(account));

    if (accounts.length > 0) {
      const lastSent = Math.max(
        ...accounts.map((account) => account.selfDeleteLastSentAt?.getTime() || 0),
      );
      if (lastSent && (Date.now() - lastSent) / 1000 < SELF_DELETE_RESEND_COOLDOWN_SECONDS) {
        // Still respond with the generic success message — don't leak timing/existence.
        return genericResponse();
      }

      const otp = generateOtp();
      // One code covers every account for this address, so a single
      // confirmation erases them all.
      await User.updateMany(
        { _id: { $in: accounts.map((account) => account._id) } },
        {
          selfDeleteOtpHash: await hashOtp(otp),
          selfDeleteOtpExpiresAt: getOtpExpiry(),
          selfDeleteOtpAttempts: 0,
          selfDeleteLastSentAt: new Date(),
        },
      );

      await sendMail({
        to: normalizedEmail,
        subject: 'Confirm deletion of your Nura account',
        html: getAccountDeletionOtpEmailTemplate({
          firstName: accounts[0].firstName,
          otp,
          expiryMinutes: OTP_EXPIRY_MINUTES,
        }),
      });

      logger.info('self_delete_requested', {
        userIds: accounts.map((account) => account._id),
        email: normalizedEmail,
      });
    }

    return genericResponse();
  } catch (error) {
    next(error);
  }
};

/**
 * Self-service deletion, step 2 — verifies the OTP emailed in step 1, then
 * permanently purges the account and everything tied to it. Irreversible.
 */
export const confirmSelfDeletion = async (req, res, next) => {
  try {
    const { email, code } = req.body;
    const normalizedEmail = String(email).trim().toLowerCase();

    const accounts = (
      await findAccountsByOriginalEmail(
        normalizedEmail,
        '+selfDeleteOtpHash +selfDeleteOtpExpiresAt +selfDeleteOtpAttempts role',
      )
    ).filter((account) => account.selfDeleteOtpHash && !isSelfDeletionBlocked(account));

    if (accounts.length === 0) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, ERROR_MESSAGES.SELF_DELETE_NO_REQUEST);
    }

    // All accounts for this address share one code (see requestSelfDeletion).
    const [primary] = accounts;
    const accountIds = accounts.map((account) => account._id);

    if (primary.selfDeleteOtpExpiresAt < new Date()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.SELF_DELETE_OTP_EXPIRED);
    }

    if (primary.selfDeleteOtpAttempts >= OTP_MAX_ATTEMPTS) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.SELF_DELETE_OTP_MAX_ATTEMPTS);
    }

    const isValid = await compareOtp(String(code), primary.selfDeleteOtpHash);
    if (!isValid) {
      await User.updateMany({ _id: { $in: accountIds } }, { $inc: { selfDeleteOtpAttempts: 1 } });
      return sendError(res, HTTP_STATUS.BAD_REQUEST, ERROR_MESSAGES.SELF_DELETE_OTP_INVALID);
    }

    logger.info('self_delete_confirmed', { userIds: accountIds, email: normalizedEmail });

    for (const userId of accountIds) {
      await purgeAccount(userId);
      await recordAudit({
        req,
        action: AUDIT_ACTIONS.ACCOUNT_DELETED,
        resourceType: 'user',
        resourceId: userId,
        metadata: { mode: 'self_service' },
      });
    }
    return sendResponse(res, HTTP_STATUS.OK, SUCCESS_MESSAGES.SELF_DELETE_COMPLETE);
  } catch (error) {
    next(error);
  }
};
