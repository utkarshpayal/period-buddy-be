/**
 * Pure rules for the gynac referral program (no database), so they can be
 * unit-tested. The database side is utils/referrals.js.
 */

export const REFERRAL_STATUSES = [
  'submitted',
  'invited',
  'onboarded',
  'rejected',
  'withdrawn',
  'cancelled',
];
/** Statuses that hold the email: nobody else can refer it meanwhile. */
export const LIVE_REFERRAL_STATUSES = ['submitted', 'invited', 'onboarded'];
/** Statuses that count towards a gynac's open-referral cap. */
export const OPEN_REFERRAL_STATUSES = ['submitted', 'invited'];

/** Allowed moves; anything else is refused (compare-and-set on `status`). */
export const REFERRAL_TRANSITIONS = {
  submitted: ['invited', 'rejected', 'withdrawn', 'cancelled'],
  invited: ['onboarded', 'cancelled'],
  onboarded: [],
  rejected: [],
  withdrawn: [],
  cancelled: [],
};

export const canMoveReferral = (from, to) => Boolean(REFERRAL_TRANSITIONS[from]?.includes(to));

/** The fields to $set for a status change (keeps `isLive` in step). */
export const statusFields = (status) => ({
  status,
  isLive: LIVE_REFERRAL_STATUSES.includes(status),
});

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_REGEX = /^\+?[0-9 ()-]{7,20}$/;

export const normalizeEmail = (value) =>
  String(value ?? '')
    .trim()
    .toLowerCase();

const cleanText = (value, max) => {
  const text = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, max) : '';
};

/**
 * Validate a referral form ({ name, email, phone?, note? }).
 * Returns `{ error }` or `{ value }` with cleaned fields.
 */
export const validateReferralInput = (body = {}) => {
  const name = cleanText(body.name, 120);
  const email = normalizeEmail(body.email);
  const phone = cleanText(body.phone, 20);
  const note = String(body.note ?? '')
    .trim()
    .slice(0, 500);
  if (name.length < 2) return { error: "Enter your colleague's name" };
  if (!EMAIL_REGEX.test(email) || email.length > 254) {
    return { error: 'Enter a valid email address' };
  }
  if (phone && !PHONE_REGEX.test(phone)) return { error: 'Enter a valid phone number' };
  const specialty = cleanText(body.specialty, 80);
  return {
    value: {
      name,
      email,
      ...(phone ? { phone } : {}),
      ...(note ? { note } : {}),
      ...(specialty ? { specialty } : {}),
    },
  };
};

/** Whole number in [min, max], or null. */
export const intInRange = (value, min, max) => {
  const n = Number(value);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

/** When a credit granted at `from` expires (null = never). */
export const creditExpiryFor = (from, expiryDays) =>
  expiryDays ? new Date(new Date(from).getTime() + expiryDays * 86_400_000) : null;

/** Sessions still usable on one credit right now. */
export const remainingOnCredit = (credit, now = new Date()) => {
  if (!credit || credit.status !== 'active') return 0;
  if (credit.expiresAt && new Date(credit.expiresAt) <= now) return 0;
  return Math.max(0, (credit.sessionsGranted || 0) - (credit.sessionsUsed || 0));
};

/** Display state of a credit: active / used_up / revoked / expired. */
export const creditState = (credit, now = new Date()) => {
  if (credit.status === 'revoked') return 'revoked';
  if (credit.status === 'expired') return 'expired';
  if (credit.expiresAt && new Date(credit.expiresAt) <= now) return 'expired';
  return remainingOnCredit(credit, now) > 0 ? 'active' : 'used_up';
};

/** Totals across a gynac's credits. */
export const summarizeCredits = (credits = [], now = new Date()) =>
  credits.reduce(
    (acc, c) => {
      acc.granted += c.sessionsGranted || 0;
      acc.used += c.sessionsUsed || 0;
      acc.revoked += c.sessionsRevoked || 0;
      acc.remaining += remainingOnCredit(c, now);
      acc.commissionSavedMinor += (c.usages || []).reduce(
        (sum, u) => sum + (u.commissionSavedMinor || 0),
        0,
      );
      return acc;
    },
    { granted: 0, used: 0, remaining: 0, revoked: 0, commissionSavedMinor: 0 },
  );

/**
 * Order credits are used in: the one expiring soonest first (never-expiring
 * last), then the oldest. Mongo sorts null before dates, hence this.
 */
export const compareCreditUse = (a, b) => {
  const ax = a.expiresAt ? new Date(a.expiresAt).getTime() : Infinity;
  const bx = b.expiresAt ? new Date(b.expiresAt).getTime() : Infinity;
  if (ax !== bx) return ax - bx;
  return (
    new Date(a.createdAt || a.grantedAt).getTime() - new Date(b.createdAt || b.grantedAt).getTime()
  );
};

/**
 * Should a paid consultation use a free session? Only when Nura would take
 * commission on it (nothing to waive on a 0% doctor or a free session) and
 * it was paid after the credit was granted (no spending credits on
 * reconciler backfills of older sessions).
 */
export const shouldUseFreeSession = ({ commissionMinor, paidAt, grantedAt }) =>
  commissionMinor > 0 && Boolean(paidAt) && new Date(paidAt) >= new Date(grantedAt);
