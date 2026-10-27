// Pricing rules for subscriptions: the 2026 catalog, annual savings, tax
// breakdown, founding-member offer eligibility, renewal stacking, which
// features an entitlement set unlocks, and fair-use limits. Pure (no DB, no
// network) so every money rule is unit-tested in
// src/utils/__tests__/pricing.test.js. Live prices are database rows edited
// from the Content Studio; PRICING_2026 is only what the seeder inserts on a
// fresh database and what scripts/applyPricing2026.js proposes.

export const PREMIUM_FAMILY = 'premium';

/** Features Nura Premium includes. Voice check-in calls are deliberately not
 * here: minutes aren't metered yet and the provider cost isn't confirmed. */
export const PREMIUM_FEATURE_KEYS = [
  'ai_assistant',
  'document_chat',
  'health_reports',
  'symptom_checker',
  'symptom_predictions',
  'partner_connect',
  'period_buddy',
];

export const FOUNDING_PROMO_KIND = 'founding';

export const PRICING_2026 = {
  plans: [
    {
      slug: 'premium-monthly',
      name: 'Nura Premium',
      description: 'Every Premium feature, billed monthly.',
      family: PREMIUM_FAMILY,
      price: 99,
      billingCycle: 'monthly',
      features: PREMIUM_FEATURE_KEYS,
      isActive: true,
      sortOrder: 1,
    },
    {
      slug: 'premium-yearly',
      name: 'Nura Premium, yearly',
      description: 'Every Premium feature, billed once a year.',
      family: PREMIUM_FAMILY,
      price: 799,
      billingCycle: 'yearly',
      features: PREMIUM_FEATURE_KEYS,
      isActive: true,
      sortOrder: 2,
    },
    {
      // Off until an admin turns it on (isActive) in the Content Studio.
      slug: 'premium-founding',
      name: 'Nura Premium, founding member',
      description: 'Your first year of Premium at a founding-member price.',
      family: PREMIUM_FAMILY,
      price: 499,
      billingCycle: 'yearly',
      features: PREMIUM_FEATURE_KEYS,
      isActive: false,
      sortOrder: 3,
      promo: {
        kind: FOUNDING_PROMO_KIND,
        maxRedemptions: 500,
        endsAt: null,
        renewalPlanSlug: 'premium-yearly',
      },
    },
  ],
  // Add-on prices by feature key. `yearlyPrice` is the annual option.
  features: {
    ai_assistant: { isPremium: true, price: 29, yearlyPrice: 290, billingCycle: 'monthly' },
    document_chat: { isPremium: true, price: 39, yearlyPrice: 390, billingCycle: 'monthly' },
    health_reports: { isPremium: true, price: 19, yearlyPrice: 190, billingCycle: 'monthly' },
    symptom_checker: { isPremium: true, price: 29, yearlyPrice: 290, billingCycle: 'monthly' },
    symptom_predictions: { isPremium: true, price: 19, yearlyPrice: 190, billingCycle: 'monthly' },
    partner_connect: { isPremium: true, price: 19, yearlyPrice: 190, billingCycle: 'monthly' },
    period_buddy: { isPremium: true, price: 19, yearlyPrice: 190, billingCycle: 'monthly' },
    // Posting is free for everyone.
    community_posting: { isPremium: false, price: 0, yearlyPrice: null },
    // Saving a scheme to "My applications" is free. Paid application
    // assistance isn't offered until a person actually helps with it.
    government_scheme_applications: { isPremium: false, price: 0, yearlyPrice: null },
  },
};

const round2 = (n) => Math.round(n * 100) / 100;
const round1 = (n) => Math.round(n * 10) / 10;

/** Yearly vs twelve monthly payments. `saving` is null when yearly isn't cheaper. */
export const annualComparison = (monthlyPrice, yearlyPrice) => {
  const twelveMonthly = monthlyPrice * 12;
  const saving = twelveMonthly - yearlyPrice;
  return {
    twelveMonthly,
    monthlyEquivalent: round2(yearlyPrice / 12),
    saving: saving > 0 ? saving : null,
    savingPercent: saving > 0 ? round1((saving / twelveMonthly) * 100) : null,
  };
};

export const TAX_DEFAULTS = { ratePercent: 18, pricesIncludeTax: true };

/** What's charged for a listed price, and the GST inside it. */
export const taxBreakdown = (price, tax = TAX_DEFAULTS) => {
  const rate = (Number(tax?.ratePercent) || 0) / 100;
  const inclusive = tax?.pricesIncludeTax !== false;
  if (inclusive) {
    const base = round2(price / (1 + rate));
    return {
      base,
      tax: round2(price - base),
      total: round2(price),
      inclusive,
      ratePercent: rate * 100,
    };
  }
  const taxAmount = round2(price * rate);
  return {
    base: round2(price),
    tax: taxAmount,
    total: round2(price + taxAmount),
    inclusive,
    ratePercent: rate * 100,
  };
};

/** Whether a promo plan can be bought right now, by anyone. Never fakes
 * scarcity: the only limits are the admin's real cap and end date. */
export const promoStatus = (plan, now = new Date()) => {
  if (!plan?.promo?.kind) return { available: true, reason: null };
  if (!plan.isActive) return { available: false, reason: 'inactive' };
  const { endsAt, maxRedemptions, redeemedCount = 0 } = plan.promo;
  if (endsAt && new Date(endsAt) <= now) return { available: false, reason: 'ended' };
  if (maxRedemptions != null && redeemedCount >= maxRedemptions) {
    return { available: false, reason: 'sold_out' };
  }
  return { available: true, reason: null };
};

/** The founding offer is for new paid members: once per account, never for
 * someone who already paid for Premium, and once per phone number. */
export const foundingEligibility = ({
  status,
  hadPaidPremium,
  usedFounding,
  phoneUsedFounding,
}) => {
  if (!status.available) return { eligible: false, reason: status.reason };
  if (usedFounding || phoneUsedFounding) return { eligible: false, reason: 'already_used' };
  if (hadPaidPremium) return { eligible: false, reason: 'existing_member' };
  return { eligible: true, reason: null };
};

const isLive = (entitlement, now) =>
  entitlement.status === 'active' &&
  (!entitlement.expiresAt || new Date(entitlement.expiresAt) > now);

/** Where a new purchase's access starts: after the buyer's current access to
 * the same thing (same plan family, or same feature) ends, so renewing early
 * extends access instead of overlapping time already paid for. */
export const accessStart = (entitlements, { family, featureKey }, now = new Date()) => {
  let start = now;
  for (const e of entitlements) {
    if (!isLive(e, now) || !e.expiresAt) continue;
    const sameThing =
      (family && e.source === 'plan' && e.plan?.family === family) ||
      (featureKey && e.source === 'feature' && e.featureKey === featureKey);
    if (sameThing && new Date(e.expiresAt) > start) start = new Date(e.expiresAt);
  }
  return start;
};

/** monthly -> +30d, yearly -> +365d, one_time -> never expires. */
export const expiryFrom = (billingCycle, start) => {
  const days = billingCycle === 'monthly' ? 30 : billingCycle === 'yearly' ? 365 : null;
  if (days == null) return null;
  const d = new Date(start);
  d.setDate(d.getDate() + days);
  return d;
};

/** Feature keys unlocked by free features plus live entitlements, or 'ALL'
 * while subscriptions are switched off. Refunded, failed, pending, cancelled
 * and expired entitlements unlock nothing. */
export const resolveUnlockedKeys = ({
  subscriptionEnabled,
  freeKeys,
  entitlements,
  now = new Date(),
}) => {
  if (!subscriptionEnabled) return 'ALL';
  const keys = new Set(freeKeys);
  for (const e of entitlements) {
    if (!isLive(e, now)) continue;
    if (e.source === 'feature' && e.featureKey) keys.add(e.featureKey);
    else if (e.source === 'plan' && e.plan) for (const key of e.plan.features || []) keys.add(key);
  }
  return keys;
};

/** 'premium' with a live plan entitlement (or while everything is free),
 * else 'free'. Picks the fair-use allowance. */
export const usageTier = ({ subscriptionEnabled, entitlements, now = new Date() }) => {
  if (!subscriptionEnabled) return 'premium';
  return entitlements.some((e) => e.source === 'plan' && isLive(e, now)) ? 'premium' : 'free';
};

/** Proposed starting limits, all editable in SubscriptionSettings.fairUse.
 * Off by default: switching them on is an admin decision. */
export const FAIR_USE_DEFAULTS = {
  enabled: false,
  aiMessagesPerDay: { free: 20, premium: 100 },
  documentsPerMonth: { free: 2, premium: 2 },
  maxPagesPerDocument: { free: 5, premium: 5 },
  doctorReportsPerMonth: { free: 1, premium: 1 },
};

/** Counted actions: which limit applies and over what period. */
export const QUOTAS = {
  ai_message: { limit: 'aiMessagesPerDay', period: 'day' },
  document_upload: { limit: 'documentsPerMonth', period: 'month' },
  doctor_report: { limit: 'doctorReportsPerMonth', period: 'month' },
};

/** The limit for a quota key and tier, or null when fair use is off or no
 * limit is set. */
export const limitFor = (fairUse, quotaKey, tier) => {
  if (!fairUse?.enabled) return null;
  const field = QUOTAS[quotaKey]?.limit;
  const value = field ? fairUse[field]?.[tier] : undefined;
  return Number.isFinite(value) && value >= 0 ? value : null;
};

/** Largest page count allowed for one document, or null when unlimited. */
export const maxPagesFor = (fairUse, tier) => {
  if (!fairUse?.enabled) return null;
  const value = fairUse.maxPagesPerDocument?.[tier];
  return Number.isFinite(value) && value > 0 ? value : null;
};

const IST_OFFSET_MS = 330 * 60 * 1000;

/** The counting period an action falls in, on the India calendar:
 * 'd:YYYY-MM-DD' or 'm:YYYY-MM'. */
export const periodKey = (period, now = new Date()) => {
  const ist = new Date(now.getTime() + IST_OFFSET_MS).toISOString();
  return period === 'day' ? `d:${ist.slice(0, 10)}` : `m:${ist.slice(0, 7)}`;
};

/** When the period containing `now` resets (start of the next IST day/month). */
export const periodResetsAt = (period, now = new Date()) => {
  const ist = new Date(now.getTime() + IST_OFFSET_MS);
  const next =
    period === 'day'
      ? Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate() + 1)
      : Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth() + 1, 1);
  return new Date(next - IST_OFFSET_MS);
};
