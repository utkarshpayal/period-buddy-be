import rateLimit, { ipKeyGenerator } from 'express-rate-limit';

/**
 * Centralized rate limiters.
 *
 * Enabled by default in production; can be forced on/off with RATE_LIMIT_ENABLED.
 * All limits are overridable via env so ops can tune them without a code change
 * (see .env.example). Limits are deliberately generous so normal usage is never
 * blocked — the goal is to stop brute-force / abuse, not throttle real users.
 */

const isProduction = process.env.NODE_ENV === 'production';

// RATE_LIMIT_ENABLED overrides the default (on in prod, off elsewhere).
export const rateLimitEnabled =
  process.env.RATE_LIMIT_ENABLED != null ? process.env.RATE_LIMIT_ENABLED === 'true' : isProduction;

const toInt = (value, fallback) => {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

const windowMs = toInt(process.env.RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000);

/**
 * General API limiter — mounted on /api. Broad safety net against abuse.
 */
export const apiLimiter = rateLimit({
  windowMs,
  max: toInt(process.env.RATE_LIMIT_MAX_REQUESTS, 500),
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: 'Too many requests, please try again later.' },
});

/**
 * Strict limiter for sensitive auth endpoints (login, signup, OTP request/verify,
 * account-deletion codes). Guards against credential/OTP brute force. Keyed by IP.
 */
export const authLimiter = rateLimit({
  windowMs: toInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.AUTH_RATE_LIMIT_MAX, 20),
  standardHeaders: true,
  legacyHeaders: false,
  // Only failed attempts count toward the limit, so a legitimate user who logs
  // in successfully isn't penalised for earlier typos.
  skipSuccessfulRequests: true,
  message: {
    success: false,
    message: 'Too many attempts. Please wait a few minutes and try again.',
  },
});

/**
 * OTP-specific limiter, keyed by the target email (falling back to IP when
 * no email is present) rather than IP alone. `authLimiter` above caps
 * attempts per requesting IP, but `verifyOtp`'s own 5-attempts-per-pending-doc
 * cap resets on every `resendOtp` call — so an attacker cycling
 * resend→guess×5→resend from one IP only ever bumps into the *shared* IP
 * budget, not anything scoped to the OTP/email itself. If `authLimiter` were
 * ever disabled or misconfigured (e.g. a non-"production" deploy), a 6-digit
 * OTP would otherwise be brute-forceable over time with no independent cap.
 * Keyed on lowercased `req.body.email` so it can't be bypassed by varying IP.
 */
export const otpEmailLimiter = rateLimit({
  windowMs: toInt(process.env.OTP_EMAIL_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
  max: toInt(process.env.OTP_EMAIL_RATE_LIMIT_MAX, 20),
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  keyGenerator: (req) => {
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : null;
    // ipKeyGenerator collapses IPv6 addresses to their /56 subnet so a client
    // can't dodge the limit by rotating through its own IPv6 range.
    return email || ipKeyGenerator(req.ip);
  },
  message: {
    success: false,
    message: 'Too many attempts for this account. Please wait a few minutes and try again.',
  },
});

/**
 * Video consultation join tokens and attendance reports
 * (videoCallController.js), keyed by the signed-in user, so one
 * account can't mint tokens in a loop. A normal call needs a handful (join,
 * a reconnect or two, joined/left reports). Mount after `authenticate`.
 */
export const videoJoinLimiter = rateLimit({
  windowMs: toInt(process.env.VIDEO_JOIN_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
  max: toInt(process.env.VIDEO_JOIN_RATE_LIMIT_MAX, 30),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.userId ? `user:${req.userId}` : ipKeyGenerator(req.ip)),
  message: {
    success: false,
    message: 'Too many attempts to join the call. Please wait a minute and try again.',
  },
});

/**
 * Joined/left reports from the call screens: their own budget, so a flaky
 * connection (several rejoins) can never use up the join limit above.
 */
export const videoAttendanceLimiter = rateLimit({
  windowMs: toInt(process.env.VIDEO_JOIN_RATE_LIMIT_WINDOW_MS, 10 * 60 * 1000),
  max: toInt(process.env.VIDEO_ATTENDANCE_RATE_LIMIT_MAX, 120),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.userId ? `user:${req.userId}` : ipKeyGenerator(req.ip)),
  message: { success: false, message: 'Too many requests, please try again later.' },
});

/**
 * No-op passthrough used when rate limiting is disabled (e.g. local dev), so
 * call sites can mount a limiter unconditionally without branching.
 */
export const noopLimiter = (req, res, next) => next();
