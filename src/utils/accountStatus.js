import User from '../models/User.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { sendMail } from './mailer.js';
import { getAccountSuspendedTemplate } from '../templates/emailTemplates.js';
import logger from './logger.js';

/** Machine-readable `code` on the 403 body, so clients can show a dedicated
 * "account suspended" message instead of a generic auth failure. */
export const ACCOUNT_SUSPENDED_CODE = 'ACCOUNT_SUSPENDED';

export const ACCOUNT_SUSPENDED_MESSAGE =
  'Your account has been suspended. We have emailed you the details — please contact support if you think this is a mistake.';

/** Minimum gap between suspension emails for one account, so repeated login
 * attempts can't be used to flood the owner's inbox. */
export const SUSPENSION_NOTICE_INTERVAL_MS = 24 * 60 * 60 * 1000;

export const supportEmail = () => process.env.SUPPORT_EMAIL || 'hello@thenura.care';

export const DELETED_EMAIL_PREFIX = 'deleted_';

/** The placeholder email a self-deleted account is renamed to, which frees
 * the real address for a new signup while keeping it recoverable for the
 * later purge (see originalEmailOf). */
export const deletedEmailFor = (userId, email) => `${DELETED_EMAIL_PREFIX}${userId}_${email}`;

/** Inverse of deletedEmailFor — the address the owner signed up with. */
export const originalEmailOf = (user) => {
  const email = String(user?.email || '');
  const match = email.match(/^deleted_[0-9a-f]{24}_(.+)$/);
  return match ? match[1] : email;
};

/**
 * Self-deleted (authController.deleteAccount → accountLifecycle.softDeleteAccount).
 * `deletedAt` is the source of truth; the `deleted_` email prefix also counts
 * so accounts deleted before `deletedAt` was written are still recognised.
 */
export const isDeletedAccount = (user) =>
  Boolean(user) &&
  (Boolean(user.deletedAt) || String(user.email || '').startsWith(DELETED_EMAIL_PREFIX));

/**
 * `isActive: false` means one of two things: an admin suspended the account
 * (PATCH /api/admin/users/:id/status), or the user deleted it themselves.
 * Only the first is a suspension — a deleted account should keep looking
 * like it doesn't exist.
 */
export const isSuspended = (user) =>
  Boolean(user) && user.isActive === false && !isDeletedAccount(user);

/** 'active' | 'suspended' | 'deleted' — for admin listings. */
export const accountStateOf = (user) =>
  isDeletedAccount(user) ? 'deleted' : user?.isActive === false ? 'suspended' : 'active';

/** Mongo filter for accounts that are live (not suspended, not deleted). */
export const ACTIVE_ACCOUNT_FILTER = { isActive: true, deletedAt: null };

/**
 * The subset of `ids` that belong to live accounts, as a Set of strings.
 * Background jobs (reminders, check-in calls) iterate other collections keyed
 * by userId, so they use this to skip suspended/deleted accounts.
 */
export const activeUserIdSet = async (ids) => {
  const unique = [...new Set((ids || []).filter(Boolean).map(String))];
  if (unique.length === 0) return new Set();
  const rows = await User.find({ _id: { $in: unique }, ...ACTIVE_ACCOUNT_FILTER })
    .select('_id')
    .lean();
  return new Set(rows.map((row) => String(row._id)));
};

export const shouldSendSuspensionNotice = (user, now = Date.now()) => {
  const last = user?.suspensionNoticeSentAt ? new Date(user.suspensionNoticeSentAt).getTime() : 0;
  return !last || now - last >= SUSPENSION_NOTICE_INTERVAL_MS;
};

/**
 * Login / Google sign-in answer 403 (credentials were fine, access is
 * refused). The auth middleware passes 401 instead: every existing client
 * already signs out on a 401 from an authenticated request (the Admin
 * Workspace's handleUnauthorized(), the app's onUnauthorized), so a user
 * suspended mid-session is still logged out everywhere — the `code` just
 * lets a client explain why.
 */
export const sendAccountSuspendedError = (res, statusCode = HTTP_STATUS.FORBIDDEN) =>
  res.status(statusCode).json({
    success: false,
    statusCode,
    message: ACCOUNT_SUSPENDED_MESSAGE,
    code: ACCOUNT_SUSPENDED_CODE,
  });

/**
 * Emails the account owner that a sign-in was blocked because the account is
 * suspended. Only call this once the caller has proven they own the account
 * (correct password / verified Google token) — never on email alone.
 * Throttled per account, never throws: a mail failure must not change the
 * login response.
 */
export const notifySuspendedLoginAttempt = async (user) => {
  try {
    if (!shouldSendSuspensionNotice(user)) return;
    // Claim the slot atomically first, so two near-simultaneous attempts
    // can't both send.
    const claimed = await User.findOneAndUpdate(
      {
        _id: user._id,
        $or: [
          { suspensionNoticeSentAt: { $exists: false } },
          { suspensionNoticeSentAt: null },
          {
            suspensionNoticeSentAt: { $lte: new Date(Date.now() - SUSPENSION_NOTICE_INTERVAL_MS) },
          },
        ],
      },
      { suspensionNoticeSentAt: new Date() },
    );
    if (!claimed) return;

    await sendMail({
      to: user.email,
      subject: 'Your Nura account is suspended',
      replyTo: supportEmail(),
      html: getAccountSuspendedTemplate({
        firstName: user.firstName,
        supportEmail: supportEmail(),
      }),
    });
    logger.info('suspended_login_notice_sent', {
      action: 'suspended_login_notice_sent',
      userId: user._id,
    });
  } catch (error) {
    logger.error('suspended_login_notice_failed', {
      action: 'suspended_login_notice_failed',
      userId: user?._id,
      error: error.message,
    });
  }
};
