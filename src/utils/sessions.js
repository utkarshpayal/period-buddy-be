import crypto from 'crypto';
import User from '../models/User.js';
import UserSession from '../models/UserSession.js';
import { isStaffRole } from '../config/permissions.js';
import { decodeToken, generateToken, verifyToken } from './jwt.js';
import logger from './logger.js';

/**
 * Revocable sign-in sessions. Every login gets a UserSession row and its
 * token carries the row's id (`sid`), so a session can be ended server-side:
 * logout ends this device, "log out everywhere" / password change / account
 * deletion / suspension end all of them.
 *
 * Tokens without a `sid` (issued before this existed, or the short-lived
 * check-in call tokens) can't be looked up one by one; they're cut off by
 * the user's `sessionsRevokedAt` instead, which rejects any token issued
 * before it.
 *
 * Staff (Admin Workspace / CMS) sessions last STAFF_SESSION_TTL (12h by
 * default) instead of the app's JWT_EXPIRE (7d): they can read other people's
 * data, so a stolen staff token must not live for a week.
 */

export const SESSION_REVOKED = 'Session revoked';
const APP_TTL = process.env.JWT_EXPIRE || '7d';
const STAFF_TTL = process.env.STAFF_SESSION_TTL || '12h';
// lastActiveAt is for the "your devices" list; writing it on every request
// would double the auth cost for nothing.
const TOUCH_EVERY_MS = 5 * 60 * 1000;

const hashSid = (sid) => crypto.createHash('sha256').update(sid).digest('hex');

const platformOf = (req) => {
  const ua = String(req?.get?.('User-Agent') || '');
  if (/okhttp|android/i.test(ua)) return 'android';
  if (/darwin|cfnetwork|iphone|ipad/i.test(ua)) return 'ios';
  return ua ? 'web' : undefined;
};

/**
 * Start a session for `user` and return its token. `req` (optional) records
 * the device for the sessions list.
 */
export const startSession = async (user, req) => {
  const sid = crypto.randomBytes(24).toString('base64url');
  const token = generateToken(
    { userId: user._id, email: user.email, role: user.role, sid },
    { expiresIn: isStaffRole(user.role) ? STAFF_TTL : APP_TTL },
  );
  const { exp } = decodeToken(token);
  const deviceId = req?.get?.('X-Device-Id');
  await UserSession.create({
    userId: user._id,
    token: hashSid(sid),
    deviceInfo: {
      platform: platformOf(req),
      deviceId: typeof deviceId === 'string' ? deviceId.slice(0, 64) : undefined,
      appVersion: req?.get?.('X-App-Version')?.slice(0, 20),
    },
    userAgent: String(req?.get?.('User-Agent') || '').slice(0, 200) || undefined,
    ipAddress: req?.ip,
    expiresAt: new Date(exp * 1000),
  });
  return token;
};

/**
 * Verify a bearer token and load its user: `{ user, decoded, session }`.
 * Throws 'Token expired', 'Invalid token: …' or SESSION_REVOKED. Doesn't
 * judge the account itself (inactive / suspended): callers do.
 */
export const resolveToken = async (token) => {
  const decoded = verifyToken(token);
  const user = await User.findById(decoded.userId);
  if (!user) return { user: null, decoded, session: null };

  const revokedAt = user.sessionsRevokedAt?.getTime?.();
  if (revokedAt && (decoded.iat ?? 0) < Math.floor(revokedAt / 1000)) {
    throw new Error(SESSION_REVOKED);
  }

  let session = null;
  if (decoded.sid) {
    session = await UserSession.findOne({ token: hashSid(decoded.sid) })
      .select('userId isRevoked expiresAt lastActiveAt')
      .lean();
    if (
      !session ||
      session.isRevoked ||
      String(session.userId) !== String(user._id) ||
      session.expiresAt <= new Date()
    ) {
      throw new Error(SESSION_REVOKED);
    }
    if (Date.now() - new Date(session.lastActiveAt).getTime() > TOUCH_EVERY_MS) {
      UserSession.updateOne({ _id: session._id }, { lastActiveAt: new Date() }).catch(() => {});
    }
  }
  return { user, decoded, session };
};

/** End one session (this device's logout). */
export const revokeSession = async (sessionId) => {
  if (!sessionId) return;
  await UserSession.updateOne({ _id: sessionId }, { isRevoked: true });
};

/**
 * End every session of `userId`, including tokens without a session id.
 * Used by "log out everywhere", password changes, deletion and suspension.
 */
export const revokeAllSessions = async (userId, reason) => {
  await Promise.all([
    UserSession.updateMany({ userId, isRevoked: false }, { isRevoked: true }),
    User.updateOne({ _id: userId }, { sessionsRevokedAt: new Date() }),
  ]);
  logger.info('sessions_revoked', { action: 'sessions_revoked', userId: String(userId), reason });
};

/** The user's live sessions for a "your devices" list, newest activity first. */
export const listSessions = async (userId, currentSessionId) => {
  const sessions = await UserSession.find({
    userId,
    isRevoked: false,
    expiresAt: { $gt: new Date() },
  })
    .sort({ lastActiveAt: -1 })
    .select('deviceInfo userAgent createdAt lastActiveAt expiresAt')
    .lean();
  return sessions.map((s) => ({
    id: String(s._id),
    platform: s.deviceInfo?.platform ?? null,
    appVersion: s.deviceInfo?.appVersion ?? null,
    userAgent: s.userAgent ?? null,
    signedInAt: s.createdAt,
    lastActiveAt: s.lastActiveAt,
    expiresAt: s.expiresAt,
    current: Boolean(currentSessionId) && String(s._id) === String(currentSessionId),
  }));
};
