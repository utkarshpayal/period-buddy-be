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

export const supportEmail = () => process.env.SUPPORT_EMAIL || 'support@thenura.care';

/**
 * `isActive: false` means one of two things: an admin suspended the account
 * (PATCH /api/admin/users/:id/status), or the user deleted it themselves
 * (authController.deleteAccount, which also rewrites the email to
 * `deleted_<id>_...`). Only the first is a suspension — a deleted account
 * should keep looking like it doesn't exist.
 */
export const isSuspended = (user) =>
  Boolean(user) && user.isActive === false && !String(user.email || '').startsWith('deleted_');

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
