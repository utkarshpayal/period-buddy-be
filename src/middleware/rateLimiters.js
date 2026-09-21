import rateLimit from 'express-rate-limit';

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
    return email || req.ip;
  },
  message: {
    success: false,
    message: 'Too many attempts for this account. Please wait a few minutes and try again.',
  },
});

/**
 * No-op passthrough used when rate limiting is disabled (e.g. local dev), so
 * call sites can mount a limiter unconditionally without branching.
 */
export const noopLimiter = (req, res, next) => next();
