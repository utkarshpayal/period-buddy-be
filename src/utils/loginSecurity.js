import crypto from 'crypto';
import User from '../models/User.js';
import UserSession from '../models/UserSession.js';
import LoginChallenge from '../models/LoginChallenge.js';
import { isStaffRole } from '../config/permissions.js';
import { compareOtp, generateOtp, hashOtp, OTP_MAX_ATTEMPTS } from './otp.js';
import { sendMail } from './mailer.js';
import { getLoginCodeEmailTemplate, getNewSignInTemplate } from '../templates/emailTemplates.js';
import { hashRecoveryCode, looksLikeRecoveryCode, matchTotp } from './totp.js';
import logger from './logger.js';

/**
 * Sign-in protections on top of the password (docs/SECURITY.md):
 *
 * - Account lockout: LOGIN_MAX_FAILURES (5) wrong passwords in a row lock the
 *   account for LOGIN_LOCK_MINUTES (15). Rate limits are per IP; this stops
 *   a slow guess at one account from many IPs.
 * - Two-step sign-in for staff and doctors (they can see other people's
 *   data): after the password, a code from their authenticator app (or a
 *   recovery code) if they've set one up, otherwise an emailed code; the
 *   session starts only once it's entered. On when STAFF_2FA_ENABLED=true, so it can
 *   be switched on after the Admin Workspace and CMS builds that ask for the
 *   code are deployed.
 * - "New sign-in" email when an account signs in on a device it hasn't
 *   used before.
 * - Test accounts: the emails in TEST_LOGIN_EMAILS (default: the shared test
 *   doctor) always get TEST_LOGIN_CODE instead of an emailed one. The
 *   password is still checked. Add staff emails only on staging.
 */

export const LOGIN_MAX_FAILURES = Math.max(3, Number(process.env.LOGIN_MAX_FAILURES) || 5);
export const LOGIN_LOCK_MINUTES = Math.max(1, Number(process.env.LOGIN_LOCK_MINUTES) || 15);
export const LOGIN_CODE_MINUTES = 10;
export const LOGIN_CODE_RESEND_SECONDS = 30;

/* ------------------------------ Lockout -------------------------------- */

/** Minutes left on a lock (rounded up), or 0 when the account isn't locked. */
export const lockMinutesLeft = (lockUntil, now = new Date()) => {
  const until = lockUntil ? new Date(lockUntil).getTime() : 0;
  const left = until - now.getTime();
  return left > 0 ? Math.ceil(left / 60_000) : 0;
};

export const lockedMessage = (minutes) =>
  `Too many wrong passwords. Your account is locked for ${minutes} more minute${minutes === 1 ? '' : 's'}.`;

/**
 * Count a wrong password. Returns the minutes the account is now locked for
 * (0 while it's still under the limit).
 */
export const recordFailedLogin = async (userId, now = new Date()) => {
  const updated = await User.findOneAndUpdate(
    { _id: userId },
    { $inc: { failedLoginCount: 1 } },
    { new: true, projection: { failedLoginCount: 1 } },
  ).lean();
  if ((updated?.failedLoginCount ?? 0) < LOGIN_MAX_FAILURES) return 0;
  const lockUntil = new Date(now.getTime() + LOGIN_LOCK_MINUTES * 60_000);
  await User.updateOne({ _id: userId }, { failedLoginCount: 0, lockUntil });
  logger.warn('login_account_locked', {
    action: 'login_account_locked',
    userId: String(userId),
    minutes: LOGIN_LOCK_MINUTES,
  });
  return LOGIN_LOCK_MINUTES;
};

export const clearFailedLogins = (userId) =>
  User.updateOne({ _id: userId }, { $set: { failedLoginCount: 0 }, $unset: { lockUntil: 1 } });

/* ------------------------- Two-step sign-in ---------------------------- */

export const secondFactorEnabled = () => process.env.STAFF_2FA_ENABLED === 'true';

/** Staff (Admin Workspace / CMS) and doctors: the accounts two-step sign-in is for. */
export const canUseSecondFactor = (user) =>
  Boolean(user && (isStaffRole(user.role) || user.role === 'doctor'));

/**
 * Must this sign-in pass a second step? For staff and doctors when it's
 * switched on for everyone, and always for anyone who set up an
 * authenticator app themselves.
 */
export const requiresSecondFactor = (user, enabled = secondFactorEnabled()) =>
  canUseSecondFactor(user) && (enabled || Boolean(user?.twoFactor?.totpEnabledAt));

/** "an****@thenura.care", so the screen can say where the code went. */
export const maskEmail = (email) => {
  const [name = '', domain = ''] = String(email || '').split('@');
  if (!domain) return '';
  const shown = name.slice(0, Math.min(2, name.length));
  return `${shown}${'*'.repeat(Math.max(1, name.length - shown.length))}@${domain}`;
};

const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');

const emailCode = async (user, code) => {
  const result = await sendMail({
    to: user.email,
    subject: 'Your Nura sign-in code',
    html: getLoginCodeEmailTemplate({
      firstName: user.firstName,
      otp: code,
      expiryMinutes: LOGIN_CODE_MINUTES,
    }),
  });
  // Without a mail provider (local dev) the code would be unreachable.
  if (result?.reason === 'not_configured' && process.env.NODE_ENV !== 'production') {
    logger.info('login_code_dev', { action: 'login_code_dev', userId: String(user._id), code });
  }
};

// Test accounts: always sign in with this code, no email sent.
// TEST_LOGIN_EMAILS (comma-separated) replaces the default list.
const DEFAULT_TEST_LOGIN_EMAILS = 'jenony@forexzig.com';
const TEST_LOGIN_CODE = '000000';
export const testLoginEmails = (raw = process.env.TEST_LOGIN_EMAILS ?? DEFAULT_TEST_LOGIN_EMAILS) =>
  String(raw)
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
const testCodeFor = (email) =>
  testLoginEmails().includes(
    String(email ?? '')
      .trim()
      .toLowerCase(),
  )
    ? TEST_LOGIN_CODE
    : null;

/** Has this person set up an authenticator app? */
export const hasAuthenticator = (user) => Boolean(user?.twoFactor?.totpEnabledAt);

/**
 * Start the second step and return what the client needs. With an
 * authenticator app set up, the code comes from the app (or a recovery
 * code); otherwise one is emailed.
 */
export const startLoginChallenge = async (user) => {
  const challengeToken = crypto.randomBytes(32).toString('base64url');
  const totp = hasAuthenticator(user);
  const fixed = totp ? null : testCodeFor(user.email);
  const code = totp ? null : fixed || generateOtp();
  await LoginChallenge.deleteMany({ userId: user._id });
  await LoginChallenge.create({
    userId: user._id,
    tokenHash: hashToken(challengeToken),
    method: totp ? 'totp' : 'email',
    ...(code && { codeHash: await hashOtp(code) }),
    expiresAt: new Date(Date.now() + LOGIN_CODE_MINUTES * 60_000),
  });
  if (fixed) {
    logger.warn('login_test_code', { action: 'login_test_code', userId: String(user._id) });
  } else if (code) {
    await emailCode(user, code);
  }
  return {
    twoFactorRequired: true,
    challengeToken,
    method: totp ? 'totp' : 'email',
    ...(!totp && { sentTo: maskEmail(user.email) }),
    expiresInMinutes: LOGIN_CODE_MINUTES,
  };
};

/**
 * Check an authenticator or recovery code for `userId`. A used recovery code
 * is removed and a used time step recorded, both with a conditional update,
 * so two requests racing with the same code can't both succeed.
 */
const checkAuthenticatorCode = async (userId, code) => {
  const user = await User.findById(userId).select(
    '+twoFactor.totpSecret +twoFactor.lastTotpStep +twoFactor.recoveryCodeHashes',
  );
  if (!user?.twoFactor?.totpSecret) return false;
  if (looksLikeRecoveryCode(code)) {
    const hash = hashRecoveryCode(code);
    const used = await User.updateOne(
      { _id: userId, 'twoFactor.recoveryCodeHashes': hash },
      { $pull: { 'twoFactor.recoveryCodeHashes': hash } },
    );
    if (used.modifiedCount !== 1) return false;
    logger.warn('login_recovery_code_used', {
      action: 'login_recovery_code_used',
      userId: String(userId),
      left: Math.max(0, (user.twoFactor.recoveryCodeHashes?.length ?? 1) - 1),
    });
    return true;
  }
  const lastStep = user.twoFactor.lastTotpStep ?? -1;
  const step = matchTotp(user.twoFactor.totpSecret, code, { lastStep });
  if (step === null) return false;
  const claimed = await User.updateOne(
    {
      _id: userId,
      $or: [
        { 'twoFactor.lastTotpStep': { $exists: false } },
        { 'twoFactor.lastTotpStep': { $lt: step } },
      ],
    },
    { $set: { 'twoFactor.lastTotpStep': step } },
  );
  return claimed.modifiedCount === 1;
};

const findChallenge = async (challengeToken) => {
  if (typeof challengeToken !== 'string' || challengeToken.length > 100) return null;
  const challenge = await LoginChallenge.findOne({ tokenHash: hashToken(challengeToken) });
  if (!challenge || challenge.expiresAt <= new Date()) return null;
  return challenge;
};

/**
 * Check a code. Returns `{ userId }` on success (the challenge is used up),
 * or `{ error }`: 'expired' (start over) or 'invalid' (try again).
 */
export const verifyLoginChallenge = async (challengeToken, code) => {
  const challenge = await findChallenge(challengeToken);
  if (!challenge) return { error: 'expired' };
  if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
    await challenge.deleteOne();
    return { error: 'expired' };
  }
  const ok =
    challenge.method === 'totp'
      ? await checkAuthenticatorCode(challenge.userId, String(code ?? '').trim())
      : /^\d{6}$/.test(String(code ?? '')) && (await compareOtp(String(code), challenge.codeHash));
  if (!ok) {
    challenge.attempts += 1;
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      await challenge.deleteOne();
      return { error: 'expired' };
    }
    await challenge.save();
    return { error: 'invalid', attemptsLeft: OTP_MAX_ATTEMPTS - challenge.attempts };
  }
  await challenge.deleteOne();
  return { userId: challenge.userId };
};

/** Email a fresh code for the same challenge. `{ error }` as above, or 'cooldown'. */
export const resendLoginChallenge = async (challengeToken) => {
  const challenge = await findChallenge(challengeToken);
  if (!challenge) return { error: 'expired' };
  // Nothing to send: the code comes from their authenticator app.
  if (challenge.method === 'totp') return { error: 'authenticator' };
  const waited = Date.now() - new Date(challenge.lastSentAt).getTime();
  if (waited < LOGIN_CODE_RESEND_SECONDS * 1000) {
    return {
      error: 'cooldown',
      retryAfterSeconds: Math.ceil((LOGIN_CODE_RESEND_SECONDS * 1000 - waited) / 1000),
    };
  }
  const user = await User.findById(challenge.userId).select('email firstName');
  if (!user) return { error: 'expired' };
  const fixed = testCodeFor(user.email);
  const code = fixed || generateOtp();
  challenge.codeHash = await hashOtp(code);
  challenge.attempts = 0;
  challenge.lastSentAt = new Date();
  challenge.expiresAt = new Date(Date.now() + LOGIN_CODE_MINUTES * 60_000);
  await challenge.save();
  if (!fixed) await emailCode(user, code);
  return { sentTo: maskEmail(user.email), expiresInMinutes: LOGIN_CODE_MINUTES };
};

/* -------------------------- New-device email --------------------------- */

const deviceOf = (req) => {
  const deviceId = req?.get?.('X-Device-Id');
  return {
    deviceId: typeof deviceId === 'string' && deviceId ? deviceId.slice(0, 64) : null,
    userAgent: String(req?.get?.('User-Agent') || '').slice(0, 200) || null,
  };
};

/**
 * True when this sign-in comes from a device the account has no session
 * for. An account with no sessions at all (older accounts, before sessions
 * existed) doesn't count: every one of them would get the email otherwise.
 * Call before startSession, which records this device.
 */
export const isNewDevice = async (userId, req, user) => {
  // The person turned "New sign-in alerts" off on the privacy screen.
  if (user?.privacySettings?.newSignInAlerts === false) return false;
  const { deviceId, userAgent } = deviceOf(req);
  if (!deviceId && !userAgent) return false;
  const any = await UserSession.exists({ userId });
  if (!any) return false;
  const known = await UserSession.exists(
    deviceId ? { userId, 'deviceInfo.deviceId': deviceId } : { userId, userAgent },
  );
  return !known;
};

/** Plain-language device name for the email: "Android app", "Chrome on Windows". */
export const describeDevice = (userAgent, appVersion) => {
  const ua = String(userAgent || '');
  if (/okhttp|android/i.test(ua) && !/chrome|firefox|safari/i.test(ua)) {
    return `Android app${appVersion ? ` (v${appVersion})` : ''}`;
  }
  if (/cfnetwork|darwin/i.test(ua)) return `iPhone app${appVersion ? ` (v${appVersion})` : ''}`;
  const browser = /edg\//i.test(ua)
    ? 'Edge'
    : /firefox/i.test(ua)
      ? 'Firefox'
      : /chrome|crios/i.test(ua)
        ? 'Chrome'
        : /safari/i.test(ua)
          ? 'Safari'
          : null;
  const os = /windows/i.test(ua)
    ? 'Windows'
    : /android/i.test(ua)
      ? 'Android'
      : /iphone|ipad/i.test(ua)
        ? 'iPhone'
        : /mac os/i.test(ua)
          ? 'Mac'
          : /linux/i.test(ua)
            ? 'Linux'
            : null;
  if (browser && os) return `${browser} on ${os}`;
  return browser || os || 'An unknown device';
};

/** Fire and forget: a failed email must never fail the sign-in. */
export const sendNewSignInEmail = (user, req) => {
  const when = new Date().toLocaleString('en-IN', {
    timeZone: 'Asia/Kolkata',
    dateStyle: 'medium',
    timeStyle: 'short',
  });
  sendMail({
    to: user.email,
    subject: 'New sign-in to your Nura account',
    html: getNewSignInTemplate({
      firstName: user.firstName,
      device: describeDevice(req?.get?.('User-Agent'), req?.get?.('X-App-Version')),
      when: `${when} IST`,
    }),
  }).catch(() => {});
};
