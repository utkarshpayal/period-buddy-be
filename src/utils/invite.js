import crypto from 'crypto';

/** How long a set-password invite link stays valid (doctors and staff). */
export const INVITE_EXPIRY_HOURS = 48;

/** Base origin for the admin/clinician CMS where invitees set their password.
 * Prefers the explicit env var; otherwise falls back per environment so the
 * link is never host-less — and, critically, never points at localhost in
 * production (which broke real invite emails).
 *
 * Localhost is opt-in (NODE_ENV must be exactly "development"), not the
 * default — a deployed host with NODE_ENV unset/misconfigured (staging,
 * or "production" never actually reaching this process) still gets the
 * real domain instead of silently leaking localhost into invite emails. */
export const adminAppBaseUrl = () => {
  const explicit = process.env.ADMIN_APP_URL || process.env.FRONTEND_URL;
  if (explicit) return explicit.replace(/\/$/, '');
  const isLocalDev = process.env.NODE_ENV === 'development';
  return isLocalDev ? 'http://localhost:5173' : 'https://admin.thenura.care';
};

/** Build the set-password link the invitee follows. */
export const buildInviteUrl = (email, rawToken) =>
  `${adminAppBaseUrl()}/set-password?token=${rawToken}&email=${encodeURIComponent(email)}`;

/** A fresh one-time invite token: the raw value goes in the email, only the
 * hash and expiry are stored on the User. */
export const createInviteToken = () => {
  const rawToken = crypto.randomBytes(32).toString('hex');
  return {
    rawToken,
    inviteTokenHash: crypto.createHash('sha256').update(rawToken).digest('hex'),
    inviteTokenExpiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
  };
};
