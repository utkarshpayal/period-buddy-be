import crypto from 'crypto';
import Doctor from '../models/Doctor.js';
import Consultation from '../models/Consultation.js';
import ConsultationMessage from '../models/ConsultationMessage.js';
import DoctorAvailability from '../models/DoctorAvailability.js';
import Reel from '../models/Reel.js';
import User from '../models/User.js';
import CycleSettings from '../models/CycleSettings.js';
import CycleLog from '../models/CycleLog.js';
import ScreeningAssessment from '../models/ScreeningAssessment.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isPaginatedRequest,
  isValidObjectId,
  pickDefined,
  sendPaginatedList,
} from '../utils/apiHelpers.js';
import { broadcastToRoom, sendRawToRoom } from '../config/websocket.js';
import { sendMail } from '../utils/mailer.js';
import { getDoctorInviteTemplate } from '../templates/emailTemplates.js';
import { userRoleEnum } from '../enums/enums.js';
import { INVITE_EXPIRY_HOURS, buildInviteUrl } from '../utils/invite.js';
import { describeAccess, isStaffRole } from '../config/permissions.js';
import { isDeletedAccount } from '../utils/accountStatus.js';
import {
  retireDoctorProfiles,
  softDeleteAccount,
  suspendAccount,
} from '../utils/accountLifecycle.js';
import { startSession } from '../utils/sessions.js';
import DoctorEarning from '../models/DoctorEarning.js';
import { describeEarning } from './doctorWalletController.js';
import { deleteFromS3, uploadBufferToS3 } from '../utils/s3.js';
import { validateWeeklyRanges } from '../utils/consultationSlots.js';
import { DEFAULT_TIME_ZONE } from '../utils/timezone.js';
import { cancelConsultationRecord, notifyUserLive } from '../utils/consultationLifecycle.js';
import { assertAllowedUpload } from '../utils/fileValidation.js';
import {
  computeWallet,
  describeWallet,
  releaseConsultationEarning,
  safeEarningHook,
} from '../utils/doctorWallet.js';

/**
 * Populate the patient on a consultation, but never expose a deleted
 * account's (renamed) email or profile: soft-deleted patients and purged ones
 * (whose paid consultations are kept for earnings, with a dangling userId)
 * both come back as a neutral placeholder instead of their details or null.
 */
const patientPopulate = (select) => ({
  path: 'userId',
  select: `${select} deletedAt`,
  transform: (doc, id) =>
    doc && !isDeletedAccount(doc)
      ? doc
      : {
          _id: doc?._id ?? id,
          firstName: 'Deleted',
          lastName: 'patient',
          email: null,
          profilePicture: null,
          isDeleted: true,
        },
});

/** Jitsi room per consultation — free, no keys, deterministic so both sides
 * of a booking land in the same room. */
const meetingLinkFor = (consultationId) =>
  `https://meet.jit.si/PeriodBuddy-Consult-${consultationId}`;

/** An https URL of a file this API uploaded (our bucket / public base), so a
 * doctor can't send patients arbitrary or `javascript:` links as attachments. */
const isOwnUploadUrl = (value) => {
  try {
    const url = new URL(String(value));
    if (url.protocol !== 'https:') return false;
    const bucket = process.env.AWS_S3_BUCKET;
    const region = process.env.AWS_REGION;
    const allowed = [
      process.env.AWS_S3_PUBLIC_URL_BASE && new URL(process.env.AWS_S3_PUBLIC_URL_BASE).host,
      bucket && region && `${bucket}.s3.${region}.amazonaws.com`,
      bucket && `${bucket}.s3.amazonaws.com`,
    ].filter(Boolean);
    return allowed.includes(url.host);
  } catch {
    return false;
  }
};

/** Resolve the Doctor profile backing the currently logged-in doctor User.
 * Returns null when the account has no linked profile. */
const getDoctorForUser = async (userId) => Doctor.findOne({ userId });

/** Session fee: whole rupees, 1 to 1,00,000. Returns the number or null. */
const MAX_SESSION_FEE = 100000;
const parsePrice = (value) => {
  const price = Number(value);
  return Number.isFinite(price) && price >= 1 && price <= MAX_SESSION_FEE
    ? Math.round(price)
    : null;
};
const PRICE_ERROR = `Session fee must be between ₹1 and ₹${MAX_SESSION_FEE.toLocaleString('en-IN')}`;

/**
 * Fee and currency from a profile update: INR is the only currency for now
 * (wallet and payouts are INR), so `currency` is ignored and always INR.
 * Returns `{ error }` or the cleaned updates.
 */
const cleanFeeUpdates = (updates) => {
  const next = { ...updates };
  delete next.currency;
  if (next.pricePerSession !== undefined) {
    const price = parsePrice(next.pricePerSession);
    if (price === null) return { error: PRICE_ERROR };
    next.pricePerSession = price;
    next.currency = 'INR';
  }
  return { updates: next };
};

/** creatorId string used to scope Reels to a doctor. */
const reelCreatorId = (doctorId) => `doctor_${doctorId}`;

/* ---------------------------------------------------------------------------
 * Admin — invite & manage gynecologists
 * ------------------------------------------------------------------------- */

/** POST /api/doctor/invite (admin) — create a doctor profile + login account
 * and email a one-time set-password link. */
export const inviteDoctor = async (req, res, next) => {
  try {
    const {
      name,
      email,
      specialty,
      pricePerSession,
      bio,
      languages,
      experience,
      hospital,
      avatarEmoji,
      education,
    } = req.body;

    if (!name?.trim() || !email?.trim() || !specialty?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'name, email, and specialty are required');
    }
    if (parsePrice(pricePerSession) === null) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, PRICE_ERROR);
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'An account with this email already exists');
    }

    // Split the display name into first/last for the User record.
    const [firstName, ...rest] = name.trim().split(/\s+/);
    const lastName = rest.join(' ') || 'Doctor';

    // Placeholder password so schema validation passes; it is unusable until
    // the invitee sets their own via the invite link (mustSetPassword gate).
    const placeholderPassword = crypto.randomBytes(24).toString('hex');

    const rawToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const user = await User.create({
      firstName,
      lastName: lastName.length >= 2 ? lastName : 'Doctor',
      email: normalizedEmail,
      password: placeholderPassword,
      role: userRoleEnum.DOCTOR,
      isEmailVerified: false,
      isActive: true,
      mustSetPassword: true,
      inviteTokenHash,
      inviteTokenExpiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
    });

    const doctor = await Doctor.create({
      userId: user._id,
      email: normalizedEmail,
      name: name.trim(),
      specialty: specialty.trim(),
      pricePerSession: parsePrice(pricePerSession),
      currency: 'INR',
      bio,
      languages: Array.isArray(languages) ? languages : [],
      experience,
      hospital,
      avatarEmoji: avatarEmoji || '👩‍⚕️',
      education: Array.isArray(education) ? education : [],
      isAvailable: true,
    });

    const inviteUrl = buildInviteUrl(normalizedEmail, rawToken);

    const mailResult = await sendMail({
      to: normalizedEmail,
      subject: 'Your Nura clinician invitation',
      html: getDoctorInviteTemplate({
        name: name.trim(),
        inviteUrl,
        expiryHours: INVITE_EXPIRY_HOURS,
        specialty: specialty.trim(),
      }),
    });

    logger.info('doctor_invited', {
      action: 'doctor_invited',
      adminId: req.userId,
      doctorId: doctor._id,
      email: normalizedEmail,
      mailDelivered: mailResult?.delivered !== false,
    });

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_INVITED,
      resourceType: 'doctor',
      resourceId: doctor._id,
      metadata: { email: normalizedEmail },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Gynecologist invited', {
      doctor,
      inviteEmailDelivered: mailResult?.delivered !== false,
      // Always surfaced so the trusted admin can copy/share the link directly,
      // regardless of whether email delivery succeeded in this environment.
      inviteUrl,
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/doctor/admin/list (admin) — all doctors with account status. */
export const listDoctorsForAdmin = async (req, res, next) => {
  try {
    const { search } = req.query;
    // Deleted doctors (deleteDoctorAccount) stay in the database for
    // earnings history but leave the admin list.
    const filter = { deletedAt: null };
    if (search) {
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { specialty: { $regex: escapeRegex(search), $options: 'i' } },
        { email: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    const query = Doctor.find(filter)
      .populate('userId', 'email isActive mustSetPassword lastLogin twoFactor.totpEnabledAt')
      .sort({ createdAt: -1, _id: -1 });

    // ?page=&limit= (default 20, max 100) — `pagination` rides on the
    // envelope; without them the full list, as older admin bundles expect.
    if (!isPaginatedRequest(req.query)) {
      return sendResponse(res, HTTP_STATUS.OK, 'Doctors fetched', await query);
    }
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const [doctors, total] = await Promise.all([
      query.skip(skip).limit(limit),
      Doctor.countDocuments(filter),
    ]);
    return sendPaginatedList(
      res,
      'Doctors fetched',
      doctors,
      buildPagination({ page, limit, total }),
    );
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/doctor/admin/:id (admin) — update a doctor profile / availability. */
export const updateDoctorByAdmin = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }

    const updates = pickDefined(req.body, [
      'name',
      'specialty',
      'pricePerSession',
      'currency',
      'bio',
      'languages',
      'experience',
      'hospital',
      'avatarEmoji',
      'education',
      'isAvailable',
    ]);
    const fee = cleanFeeUpdates(updates);
    if (fee.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, fee.error);

    const doctor = await Doctor.findByIdAndUpdate(req.params.id, fee.updates, {
      new: true,
      runValidators: true,
    });
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_UPDATED,
      resourceType: 'doctor',
      resourceId: doctor._id,
      metadata: { fields: Object.keys(updates) },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Doctor updated', doctor);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/admin/:id/resend-invite (admin) — reissue the invite link. */
export const resendInvite = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }

    const doctor = await Doctor.findById(req.params.id);
    if (!doctor || !doctor.userId) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor account not found');
    }

    const user = await User.findById(doctor.userId);
    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor account not found');
    // The invite link would otherwise be a way back in for a deactivated doctor.
    if (!user.isActive || isDeletedAccount(user)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'This doctor account is deactivated — reactivate it before resending the invite',
      );
    }

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.inviteTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.inviteTokenExpiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);
    user.mustSetPassword = true;
    user.$locals.skipPasswordHash = true; // do not re-hash the stored password
    await user.save();

    const inviteUrl = buildInviteUrl(doctor.email, rawToken);

    const mailResult = await sendMail({
      to: doctor.email,
      subject: 'Your Nura clinician invitation',
      html: getDoctorInviteTemplate({
        name: doctor.name,
        inviteUrl,
        expiryHours: INVITE_EXPIRY_HOURS,
        specialty: doctor.specialty,
      }),
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Invite resent', {
      inviteEmailDelivered: mailResult?.delivered !== false,
      inviteUrl,
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/doctor/admin/:id (admin) — deactivate a doctor & their login. */
export const deactivateDoctor = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }

    const existing = await Doctor.findById(req.params.id).select('_id userId');
    if (!existing) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    // Hidden from booking, slots and reels off, open consultations cancelled
    // (patients notified, paid ones logged for refund).
    await retireDoctorProfiles({ _id: existing._id }, { reason: 'doctor_deactivated' });

    if (existing.userId) {
      const user = await User.findByIdAndUpdate(
        existing.userId,
        { isActive: false, $unset: { inviteTokenHash: 1, inviteTokenExpiresAt: 1 } },
        { new: true },
      );
      if (user) await suspendAccount(user);
    }
    const doctor = await Doctor.findById(existing._id);

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_DEACTIVATED,
      resourceType: 'doctor',
      resourceId: doctor._id,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Doctor deactivated', doctor);
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/doctor/admin/:id/reactivate (admin) — undo a deactivation: the
 * login works again and the weekly slots come back, but bookings stay
 * paused until an admin or the doctor resumes them, and reels the doctor
 * hid stay hidden (the doctor shows them again from their portal). A doctor
 * who never set a password needs a fresh invite (`needsInvite`).
 */
export const reactivateDoctor = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }
    const doctor = await Doctor.findById(req.params.id);
    if (!doctor || doctor.deletedAt)
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');
    if (!doctor.userId) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'This doctor has no login account to reactivate',
      );
    }

    const user = await User.findById(doctor.userId);
    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor account not found');
    if (isDeletedAccount(user)) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'This account was deleted and cannot be reactivated',
      );
    }
    if (user.isActive) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This doctor is already active');
    }

    user.isActive = true;
    user.$locals.skipPasswordHash = true;
    await user.save();
    await DoctorAvailability.updateMany({ doctorId: doctor._id }, { isAvailable: true });
    doctor.isAvailable = false;
    await doctor.save();

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_REACTIVATED,
      resourceType: 'doctor',
      resourceId: doctor._id,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Doctor reactivated', {
      doctor,
      needsInvite: Boolean(user.mustSetPassword),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/doctor/admin/:id/account (admin) — remove a doctor for good:
 * taken out of service like a deactivation, the login account deleted (its
 * email freed, so the same person can be invited again later) and the
 * profile photo removed. Refused while their wallet still holds money or a
 * payout is open, so nobody loses earnings. The Doctor row is kept, marked
 * deleted, for consultation and earnings history.
 */
export const deleteDoctorAccount = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }
    const doctor = await Doctor.findById(req.params.id).select('+avatarKey');
    if (!doctor || doctor.deletedAt)
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    const wallet = await computeWallet(doctor._id);
    if (
      wallet.availableMinor > 0 ||
      wallet.onHoldMinor > 0 ||
      wallet.inFlightMinor > 0 ||
      wallet.openPayouts > 0
    ) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'This doctor still has money in their wallet (balance, earnings on hold or an open payout). ' +
          'Open paid sessions count as held earnings: deactivate the doctor first to cancel them, ' +
          'pay out or adjust any remaining balance, then delete.',
      );
    }

    await retireDoctorProfiles({ _id: doctor._id }, { reason: 'doctor_deleted' });
    if (doctor.userId) {
      const user = await User.findById(doctor.userId);
      if (user && !isDeletedAccount(user)) await softDeleteAccount(user);
    }

    const avatarKey = doctor.avatarKey;
    doctor.deletedAt = new Date();
    doctor.isAvailable = false;
    doctor.avatarUrl = undefined;
    doctor.avatarKey = undefined;
    await doctor.save();
    if (avatarKey) await deleteFromS3(avatarKey);

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_DELETED,
      resourceType: 'doctor',
      resourceId: doctor._id,
      metadata: { name: doctor.name, email: doctor.email },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Doctor deleted', { _id: doctor._id });
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Public — set password from invite link
 * ------------------------------------------------------------------------- */

/** POST /api/doctor/set-password (public) — verify the invite token and set
 * the account password, then log the doctor in. */
export const setPasswordFromInvite = async (req, res, next) => {
  try {
    const { email, token, password } = req.body;

    if (!email?.trim() || !token?.trim() || !password) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'email, token, and password are required');
    }
    if (String(password).length < 8) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Password must be at least 8 characters');
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select(
      '+password +inviteTokenHash +inviteTokenExpiresAt',
    );

    // A suspended/deactivated account's link must not reactivate it — only an
    // admin restoring access can (this used to force isActive back to true).
    if (!user || !user.inviteTokenHash || !user.isActive || isDeletedAccount(user)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This invite link is no longer valid');
    }
    if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt.getTime() < Date.now()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This invite link has expired');
    }

    const incomingHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    if (incomingHash !== user.inviteTokenHash) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This invite link is invalid');
    }

    user.password = password; // hashed by the pre-save hook
    user.inviteTokenHash = undefined;
    user.inviteTokenExpiresAt = undefined;
    user.mustSetPassword = false;
    user.isEmailVerified = true;
    user.lastLogin = new Date();
    await user.save();

    const authToken = await startSession(user, req);

    // This link also onboards Admin Workspace staff (staffController), so
    // carry their access the same way the login response does.
    const userData = user.toJSON();
    if (isStaffRole(user.role)) userData.access = describeAccess(user.role);

    return sendResponse(res, HTTP_STATUS.OK, 'Password set successfully', userData, authToken);
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — profile
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/me — the logged-in doctor's profile. */
export const getMyProfile = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Profile fetched', doctor);
  } catch (error) {
    next(error);
  }
};

/** PUT /api/doctor/me — update own profile. */
export const updateMyProfile = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const updates = pickDefined(req.body, [
      'name',
      'specialty',
      'pricePerSession',
      'currency',
      'bio',
      'languages',
      'experience',
      'hospital',
      'avatarEmoji',
      'education',
      'isAvailable',
    ]);
    const fee = cleanFeeUpdates(updates);
    if (fee.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, fee.error);

    Object.assign(doctor, fee.updates);
    await doctor.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Profile updated', doctor);
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Profile photo (doctor self-service and admin)
 * ------------------------------------------------------------------------- */

/**
 * Store `file` as the doctor's profile photo under `doctors/<id>/avatar/`
 * (a public folder: patients see it in the app), delete the photo it
 * replaces, and show it on the doctor's reels. Returns an error message for
 * a bad file, else null.
 */
const replaceDoctorAvatar = async (doctorId, file) => {
  if (!file) return { error: 'Choose an image to upload' };
  let mimeType;
  try {
    mimeType = assertAllowedUpload(file.buffer, ['image']);
  } catch (validationError) {
    return { error: validationError.message };
  }

  const doctor = await Doctor.findById(doctorId).select('+avatarKey');
  if (!doctor) return { notFound: true };

  const { url, key } = await uploadBufferToS3({
    buffer: file.buffer,
    mimeType,
    originalName: file.originalname,
    folder: `doctors/${doctor._id}/avatar`,
  });
  const previousKey = doctor.avatarKey;
  doctor.avatarUrl = url;
  doctor.avatarKey = key;
  await doctor.save();
  if (previousKey) await deleteFromS3(previousKey);
  await Reel.updateMany({ creatorId: reelCreatorId(doctor._id) }, { creatorAvatar: url });
  return { doctor: await Doctor.findById(doctor._id) };
};

const removeDoctorAvatar = async (doctorId) => {
  const doctor = await Doctor.findById(doctorId).select('+avatarKey');
  if (!doctor) return { notFound: true };
  const previousKey = doctor.avatarKey;
  doctor.avatarUrl = undefined;
  doctor.avatarKey = undefined;
  await doctor.save();
  if (previousKey) await deleteFromS3(previousKey);
  await Reel.updateMany({ creatorId: reelCreatorId(doctor._id) }, { $unset: { creatorAvatar: 1 } });
  return { doctor: await Doctor.findById(doctor._id) };
};

const sendAvatarResult = (res, result, message) => {
  if (result.notFound) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
  if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);
  return sendResponse(res, HTTP_STATUS.OK, message, result.doctor);
};

/** POST /api/doctor/me/avatar — upload own profile photo (multipart `file`). */
export const uploadMyAvatar = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    return sendAvatarResult(res, await replaceDoctorAvatar(doctor._id, req.file), 'Photo updated');
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/doctor/me/avatar — remove own profile photo. */
export const removeMyAvatar = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    return sendAvatarResult(res, await removeDoctorAvatar(doctor._id), 'Photo removed');
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/admin/:id/avatar (admin) — set a doctor's profile photo. */
export const uploadDoctorAvatarByAdmin = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }
    const result = await replaceDoctorAvatar(req.params.id, req.file);
    if (result.doctor) {
      await recordAudit({
        req,
        action: AUDIT_ACTIONS.DOCTOR_UPDATED,
        resourceType: 'doctor',
        resourceId: result.doctor._id,
        metadata: { fields: ['avatarUrl'] },
      });
    }
    return sendAvatarResult(res, result, 'Photo updated');
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/doctor/admin/:id/avatar (admin) — remove a doctor's profile photo. */
export const removeDoctorAvatarByAdmin = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }
    const result = await removeDoctorAvatar(req.params.id);
    if (result.doctor) {
      await recordAudit({
        req,
        action: AUDIT_ACTIONS.DOCTOR_UPDATED,
        resourceType: 'doctor',
        resourceId: result.doctor._id,
        metadata: { fields: ['avatarUrl'] },
      });
    }
    return sendAvatarResult(res, result, 'Photo removed');
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — dashboard
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/dashboard — headline stats for the clinician home. */
export const getDashboard = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const [statusCounts, paid, recent, wallet] = await Promise.all([
      // Unpaid (abandoned) checkouts aren't bookings.
      Consultation.aggregate([
        { $match: { doctorId: doctor._id, status: { $ne: 'pending' } } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      // A cancelled session's money goes back to the patient.
      Consultation.aggregate([
        { $match: { doctorId: doctor._id, paymentStatus: 'paid', status: { $ne: 'cancelled' } } },
        { $group: { _id: null, total: { $sum: '$amountPaid' }, count: { $sum: 1 } } },
      ]),
      Consultation.find({ doctorId: doctor._id, status: { $ne: 'pending' } })
        .populate(patientPopulate('firstName lastName email profilePicture'))
        .sort({ createdAt: -1 })
        .limit(6),
      computeWallet(doctor._id),
    ]);

    const counts = statusCounts.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
    const totalBookings = Object.values(counts).reduce((sum, n) => sum + n, 0);

    return sendResponse(res, HTTP_STATUS.OK, 'Dashboard fetched', {
      doctor: {
        name: doctor.name,
        specialty: doctor.specialty,
        avatarEmoji: doctor.avatarEmoji,
        avatarUrl: doctor.avatarUrl,
        rating: doctor.rating,
        ratingCount: doctor.ratingCount,
        isAvailable: doctor.isAvailable,
      },
      stats: {
        totalBookings,
        active: counts.active || 0,
        paid: counts.paid || 0,
        pending: counts.pending || 0,
        completed: counts.completed || 0,
        cancelled: counts.cancelled || 0,
        totalEarnings: paid[0]?.total || 0,
        paidSessions: paid[0]?.count || 0,
        currency: 'INR',
      },
      // Net of commission, from the wallet (see utils/doctorWallet.js).
      wallet: describeWallet(wallet),
      recentBookings: recent,
    });
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — bookings / consultations
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/consultations?status= — the doctor's bookings. */
export const getConsultations = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const filter = { doctorId: doctor._id };
    const { status } = req.query;
    // Unpaid checkouts never reach the doctor (no patient details before payment).
    if (status === 'pending') {
      return sendResponse(res, HTTP_STATUS.OK, 'Consultations fetched', []);
    }
    if (status) {
      // Patients never pay for a booking that stays 'pending', so hide those
      // from the doctor's default views unless explicitly requested.
      filter.status = status;
    } else {
      filter.status = { $ne: 'pending' };
    }

    // ?search= matches the patient's first/last name (or "first last"),
    // among this doctor's own patients only.
    const search = String(req.query.search || '').trim();
    if (search) {
      const pattern = escapeRegex(search).replace(/\s+/g, '\\s+');
      const patientIds = await Consultation.distinct('userId', { doctorId: doctor._id });
      const patients = await User.find({
        _id: { $in: patientIds },
        $or: [
          { firstName: { $regex: pattern, $options: 'i' } },
          { lastName: { $regex: pattern, $options: 'i' } },
          {
            $expr: {
              $regexMatch: {
                input: { $concat: ['$firstName', ' ', '$lastName'] },
                regex: pattern,
                options: 'i',
              },
            },
          },
        ],
      }).select('_id');
      filter.userId = { $in: patients.map((p) => p._id) };
    }

    const query = Consultation.find(filter)
      .populate(patientPopulate('firstName lastName email profilePicture'))
      .sort({ createdAt: -1, _id: -1 });

    // Opt-in paging (?page=&limit=, default 20, max 100); `pagination` rides
    // on the envelope so `data` stays an array either way.
    if (!isPaginatedRequest(req.query)) {
      return sendResponse(res, HTTP_STATUS.OK, 'Consultations fetched', await query);
    }
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const [consultations, total] = await Promise.all([
      query.skip(skip).limit(limit),
      Consultation.countDocuments(filter),
    ]);
    return sendPaginatedList(
      res,
      'Consultations fetched',
      consultations,
      buildPagination({ page, limit, total }),
    );
  } catch (error) {
    next(error);
  }
};

/** Load a consultation and confirm it belongs to the logged-in doctor. */
const loadOwnedConsultation = async (userId, consultationId) => {
  const doctor = await getDoctorForUser(userId);
  if (!doctor) return { error: 'Doctor profile not found', code: HTTP_STATUS.NOT_FOUND };
  if (!isValidObjectId(consultationId)) {
    return { error: 'Invalid consultation id', code: HTTP_STATUS.BAD_REQUEST };
  }
  const consultation = await Consultation.findOne({
    _id: consultationId,
    doctorId: doctor._id,
  });
  if (!consultation) return { error: 'Consultation not found', code: HTTP_STATUS.NOT_FOUND };
  return { doctor, consultation };
};

/** GET /api/doctor/consultations/:id — one of the doctor's bookings (e.g. to
 * open it from an answered call or a dashboard link). Never an unpaid checkout. */
export const getConsultation = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);
    if (consultation.status === 'pending') {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');
    }
    await consultation.populate(patientPopulate('firstName lastName email profilePicture'));
    return sendResponse(res, HTTP_STATUS.OK, 'Consultation fetched', consultation);
  } catch (error) {
    next(error);
  }
};

/** Statuses at which a doctor is "connected" to a patient and may view their
 * health data. A pending/cancelled booking grants no clinical access. */
const CONNECTED_STATUSES = ['paid', 'active', 'completed'];

/** Whole years between a date of birth and now; null when DOB is unknown. */
const ageFromDob = (dob) => {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
};

/** GET /api/doctor/consultations/:id/patient — the connected patient's health
 * overview (profile, cycle settings, recent logs, screenings). Only exposed
 * for consultations the doctor owns that reached a paid/active/completed state,
 * so a doctor can only ever see the data of a genuinely connected patient. */
export const getConsultationPatient = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    if (!CONNECTED_STATUSES.includes(consultation.status)) {
      return sendError(
        res,
        HTTP_STATUS.FORBIDDEN,
        'Patient records are available only after the booking is confirmed (paid or active).',
      );
    }

    const patientId = consultation.userId;
    const [user, cycleSettings, recentLogs, screenings] = await Promise.all([
      User.findById(patientId).select(
        'firstName lastName email profilePicture dateOfBirth gender country language deletedAt',
      ),
      CycleSettings.findOne({ userId: patientId }).select(
        'lastPeriodStartDate cycleLength periodLength pregnancyMode trackingGoal',
      ),
      CycleLog.find({ userId: patientId })
        .select('date dateKey flow mood energy symptoms phase cycleDay note')
        .sort({ date: -1 })
        .limit(14),
      ScreeningAssessment.find({ userId: patientId })
        .select('condition score riskLevel summary doctorDiscussionSummary createdAt')
        .sort({ createdAt: -1 })
        .limit(8),
    ]);

    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Patient not found');
    if (isDeletedAccount(user)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'This patient has deleted their account');
    }

    // Keep only the most recent screening per condition.
    const latestByCondition = {};
    for (const s of screenings) {
      if (!latestByCondition[s.condition]) latestByCondition[s.condition] = s;
    }

    const overview = {
      profile: {
        id: user._id,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
        email: user.email,
        profilePicture: user.profilePicture,
        gender: user.gender,
        age: ageFromDob(user.dateOfBirth),
        dateOfBirth: user.dateOfBirth,
        country: user.country,
      },
      cycle: cycleSettings
        ? {
            lastPeriodStartDate: cycleSettings.lastPeriodStartDate,
            cycleLength: cycleSettings.cycleLength,
            periodLength: cycleSettings.periodLength,
            pregnancyMode: cycleSettings.pregnancyMode,
            trackingGoal: cycleSettings.trackingGoal,
          }
        : null,
      recentLogs,
      screenings: Object.values(latestByCondition),
      consultation: {
        id: consultation._id,
        status: consultation.status,
        prescription: consultation.prescription,
        startedAt: consultation.startedAt,
      },
    };

    return sendResponse(res, HTTP_STATUS.OK, 'Patient overview fetched', overview);
  } catch (error) {
    next(error);
  }
};

/** GET /api/doctor/consultations/:id/messages */
export const getConsultationMessages = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    const messages = (
      await ConsultationMessage.find({ consultationId: consultation._id })
        .sort({ sentAt: -1 })
        .limit(300)
    ).reverse();

    // Mark inbound (patient) messages as read now that the doctor is viewing.
    await ConsultationMessage.updateMany(
      { consultationId: consultation._id, sender: 'user', readAt: null },
      { readAt: new Date() },
    );

    return sendResponse(res, HTTP_STATUS.OK, 'Messages fetched', messages);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/consultations/:id/message — doctor replies to a patient. */
export const sendConsultationMessage = async (req, res, next) => {
  try {
    const { text, attachmentUrl } = req.body;
    if (!text?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message text is required');
    if (text.trim().length > 3000) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message must be 3000 characters or fewer');
    }

    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    if (!['paid', 'active'].includes(consultation.status)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'This consultation session is not active');
    }
    if (
      attachmentUrl !== undefined &&
      attachmentUrl !== null &&
      attachmentUrl !== '' &&
      !isOwnUploadUrl(attachmentUrl)
    ) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'Attachments must be files uploaded through the portal',
      );
    }
    // Conditional, so it can't undo a patient's cancel that landed in between.
    await Consultation.updateOne({ _id: consultation._id, status: 'paid' }, { status: 'active' });

    const message = await ConsultationMessage.create({
      consultationId: consultation._id,
      sender: 'doctor',
      text: text.trim(),
      attachmentUrl: attachmentUrl || undefined,
    });

    // Broadcast the full recent log, not just this one message — the mobile
    // client replaces its local message list wholesale with whatever a "message"
    // WS event carries, so sending only the delta made every earlier message in
    // the thread disappear on the patient's side until they refreshed the screen.
    const recentMessages = (
      await ConsultationMessage.find({ consultationId: consultation._id })
        .sort({ sentAt: -1 })
        .limit(300)
    ).reverse();

    broadcastToRoom(`consultation_${consultation._id}`, { messages: recentMessages });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Message sent', message);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/consultations/:id/call — start (or resume) a video call. */
export const startVideoCall = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    if (!['paid', 'active'].includes(consultation.status)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'This consultation session is not active');
    }

    const meetingLink = consultation.meetingLink || meetingLinkFor(consultation._id);
    await Consultation.updateOne(
      { _id: consultation._id, status: { $in: ['paid', 'active'] } },
      { status: 'active', meetingLink },
    );
    consultation.meetingLink = meetingLink;

    // Let the patient's session know a call is live and where to join.
    broadcastToRoom(`consultation_${consultation._id}`, {
      event: 'call_started',
      meetingLink: consultation.meetingLink,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Video call ready', {
      meetingLink: consultation.meetingLink,
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/doctor/consultations/:id/prescription */
export const setPrescription = async (req, res, next) => {
  try {
    const { prescription } = req.body;
    if (!prescription?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Prescription text is required');
    }

    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    // Only during a live session — once completed/cancelled, the record is
    // closed and shouldn't be editable from the dashboard, disabled button
    // or not (the UI-only guard was bypassable via a direct API call).
    if (!['paid', 'active'].includes(consultation.status)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This consultation session is not active');
    }

    consultation.prescription = prescription.trim();
    await consultation.save();
    await consultation.populate(patientPopulate('firstName lastName email profilePicture'));
    broadcastToRoom(`consultation_${consultation._id}`, {
      event: 'prescription_updated',
      consultationId: String(consultation._id),
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Prescription saved', consultation);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/doctor/consultations/:id/complete */
export const completeConsultation = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    const completed = await Consultation.findOneAndUpdate(
      { _id: consultation._id, status: { $in: ['paid', 'active'] } },
      { status: 'completed', completedAt: new Date() },
      { new: true },
    ).populate(patientPopulate('firstName lastName email profilePicture'));
    if (!completed) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Only an active session can be completed');
    }
    // Starts the hold; after it the earning is withdrawable.
    await safeEarningHook('completed', () =>
      releaseConsultationEarning(completed._id, completed.completedAt),
    );
    const live = { event: 'consultation_completed', consultationId: String(completed._id) };
    broadcastToRoom(`consultation_${completed._id}`, live);
    notifyUserLive(completed.userId?._id || completed.userId, live);

    return sendResponse(res, HTTP_STATUS.OK, 'Consultation completed', completed);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/doctor/consultations/:id/cancel — `{ reason? }`. The doctor
 * cancels a paid or ongoing session; the patient is told and refunded. */
export const cancelConsultation = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    const cancelled = await cancelConsultationRecord(
      { _id: consultation._id, doctorId: consultation.doctorId },
      { by: 'doctor', reason: req.body?.reason, fromStatuses: ['paid', 'active'] },
    );
    if (!cancelled) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This consultation cannot be cancelled');
    }
    await cancelled.populate(patientPopulate('firstName lastName email profilePicture'));
    return sendResponse(res, HTTP_STATUS.OK, 'Consultation cancelled', cancelled);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/consultations/:id/call/decline — the doctor declines a
 * ringing call from the patient. */
export const declineCall = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);
    const room = `consultation_${consultation._id}`;
    sendRawToRoom(room, { type: 'call_end', room, reason: 'declined' });
    notifyUserLive(consultation.userId, {
      event: 'call_declined',
      consultationId: String(consultation._id),
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Call declined', { declined: true });
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — payments / earnings
 * ------------------------------------------------------------------------- */

/** Attach each consultation's earning (gross / commission / net / when
 * withdrawable). Sessions paid before commission tracking started have none. */
const withEarnings = async (payments) => {
  const earnings = await DoctorEarning.find({
    type: 'consultation',
    consultationId: { $in: payments.map((p) => p._id) },
  }).lean();
  const byId = new Map(earnings.map((e) => [String(e.consultationId), describeEarning(e)]));
  return payments.map((p) => ({ ...p.toJSON(), earning: byId.get(String(p._id)) || null }));
};

/** Net totals over every earning, for the Payments header. */
const earningTotals = async (doctorId) => {
  const [row] = await DoctorEarning.aggregate([
    { $match: { doctorId, type: 'consultation', status: 'active' } },
    {
      $group: {
        _id: null,
        net: { $sum: '$netMinor' },
        commission: { $sum: '$commissionMinor' },
      },
    },
  ]);
  return { net: (row?.net || 0) / 100, commission: (row?.commission || 0) / 100 };
};

/** GET /api/doctor/payments — paid sessions plus totals. Each payment also
 * carries `earning` (commission split), and `net`/`commission` total them. */
export const getPayments = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    // Listed: every session that was paid (refunded/cancelled ones included,
    // marked by their status). Totalled: only the money the doctor keeps.
    const filter = { doctorId: doctor._id, paymentStatus: { $in: ['paid', 'refunded'] } };
    const earnedFilter = {
      doctorId: doctor._id,
      paymentStatus: 'paid',
      status: { $ne: 'cancelled' },
    };
    const query = Consultation.find(filter)
      .populate(patientPopulate('firstName lastName email'))
      .sort({ startedAt: -1, createdAt: -1, _id: -1 });

    if (!isPaginatedRequest(req.query)) {
      const payments = await query;
      const earned = payments.filter((p) => p.paymentStatus === 'paid' && p.status !== 'cancelled');
      const total = earned.reduce((sum, p) => sum + (p.amountPaid || 0), 0);
      return sendResponse(res, HTTP_STATUS.OK, 'Payments fetched', {
        total,
        count: earned.length,
        currency: 'INR',
        ...(await earningTotals(doctor._id)),
        payments: await withEarnings(payments),
      });
    }

    // Paged: `total`/`count` still cover *all* paid consultations (summed in
    // the database, not over this page); `payments` is one page of them.
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const [payments, [totals]] = await Promise.all([
      query.skip(skip).limit(limit),
      Consultation.aggregate([
        { $match: earnedFilter },
        {
          $group: {
            _id: null,
            total: { $sum: { $ifNull: ['$amountPaid', 0] } },
            count: { $sum: 1 },
          },
        },
      ]),
    ]);
    const count = totals?.count ?? 0;
    const listed = await Consultation.countDocuments(filter);
    return sendResponse(res, HTTP_STATUS.OK, 'Payments fetched', {
      total: totals?.total ?? 0,
      count,
      currency: 'INR',
      ...(await earningTotals(doctor._id)),
      payments: await withEarnings(payments),
      pagination: buildPagination({ page, limit, total: listed }),
    });
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — availability
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/availability */
export const getAvailability = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const slots = await DoctorAvailability.find({ doctorId: doctor._id }).sort({
      dayOfWeek: 1,
      startTime: 1,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Availability fetched', slots);
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/doctor/availability — replace the doctor's weekly hours:
 * `{ slots: [{ dayOfWeek, startTime, endTime, maxSlots, timezone }] }`, times
 * "HH:MM" in `timezone` (IANA, e.g. "Asia/Kolkata"; one zone for all ranges).
 * Everything is validated first; the new rows are written before the old
 * ones are removed, so a failure never leaves the doctor with no schedule.
 */
export const setAvailability = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const { slots } = req.body;
    const ranges = Array.isArray(slots)
      ? slots.map((s) => ({
          dayOfWeek: Number(s?.dayOfWeek),
          startTime: s?.startTime,
          endTime: s?.endTime,
          maxSlots: Number(s?.maxSlots),
          timezone: s?.timezone || req.body.timezone || DEFAULT_TIME_ZONE,
          isAvailable: s?.isAvailable !== false,
        }))
      : slots;
    const problem = validateWeeklyRanges(ranges);
    if (problem) return sendError(res, HTTP_STATUS.BAD_REQUEST, problem);

    const previous = await DoctorAvailability.find({ doctorId: doctor._id }).select('_id').lean();
    const created = ranges.length
      ? await DoctorAvailability.insertMany(ranges.map((r) => ({ ...r, doctorId: doctor._id })))
      : [];
    if (previous.length) {
      await DoctorAvailability.deleteMany({ _id: { $in: previous.map((r) => r._id) } });
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Availability updated', created);
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — reels / content
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/reels — reels published by this doctor. */
export const getMyReels = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const reels = await Reel.find({ creatorId: reelCreatorId(doctor._id) }).sort({
      publishedAt: -1,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Reels fetched', reels);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/reels — publish a new educational reel. */
export const createReel = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const { title, thumbnailUrl, directMp4Url, category, duration, pollQuestion, pollOptions } =
      req.body;

    if (!title?.trim() || !thumbnailUrl?.trim() || !directMp4Url?.trim()) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'title, thumbnailUrl, and directMp4Url are required',
      );
    }

    const options = Array.isArray(pollOptions)
      ? pollOptions
          .map((option, index) => ({
            optionId: option.optionId || `option_${index + 1}`,
            topic: option.topic,
            votes: Number(option.votes || 0),
          }))
          .filter((option) => option.topic)
      : [];

    const reel = await Reel.create({
      title: title.trim(),
      creatorId: reelCreatorId(doctor._id),
      creatorName: doctor.name,
      // Unset without a photo, so the app shows its default creator image.
      creatorAvatar: doctor.avatarUrl || undefined,
      duration: duration || '0:30',
      category: category || doctor.specialty || 'Wellness',
      verified: true,
      thumbnailUrl: thumbnailUrl.trim(),
      directMp4Url: directMp4Url.trim(),
      pollQuestion,
      pollOptions: options,
      publishedAt: new Date(),
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Reel published', reel);
  } catch (error) {
    next(error);
  }
};

/** PUT /api/doctor/reels/:id — update one of the doctor's reels. */
export const updateReel = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    const updates = pickDefined(req.body, [
      'title',
      'duration',
      'category',
      'thumbnailUrl',
      'directMp4Url',
      'pollQuestion',
      'pollOptions',
      'isActive',
    ]);

    const reel = await Reel.findOneAndUpdate(
      { _id: req.params.id, creatorId: reelCreatorId(doctor._id) },
      updates,
      { new: true, runValidators: true },
    );
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Reel updated', reel);
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/doctor/reels/:id — soft-delete one of the doctor's reels. */
export const deleteReel = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    const reel = await Reel.findOneAndUpdate(
      { _id: req.params.id, creatorId: reelCreatorId(doctor._id) },
      { isActive: false },
      { new: true },
    );
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Reel deleted');
  } catch (error) {
    next(error);
  }
};
