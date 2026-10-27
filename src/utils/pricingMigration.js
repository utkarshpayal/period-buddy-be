import { PRICING_2026 } from './pricing.js';

// Works out what src/scripts/applyPricing2026.js would change, from the
// current feature and plan rows. Pure, so the rules are tested
// (src/utils/__tests__/pricingMigration.test.js):
// - Only the pricing catalog changes. Entitlements (what people already paid
//   for, at the price they paid) and the subscriptions master switch are
//   never touched.
// - The founding offer is created switched off, and an existing one keeps
//   whatever an admin set for isActive.
// - A feature missing from the database is skipped (the seeder adds it).
// - Plans not in the new catalog are only listed, or switched off (hidden
//   from sale) with `retireOldPlans`; people who hold them keep access.

const FEATURE_FIELDS = ['isPremium', 'price', 'yearlyPrice', 'billingCycle'];
const PLAN_FIELDS = ['name', 'description', 'price', 'billingCycle', 'family'];

const sameList = (a = [], b = []) => a.length === b.length && a.every((x, i) => x === b[i]);

export const planPricingChanges = ({ features, plans }, { retireOldPlans = false } = {}) => {
  const featureUpdates = [];
  const missingFeatures = [];
  for (const [key, target] of Object.entries(PRICING_2026.features)) {
    const current = features.find((f) => f.key === key);
    if (!current) {
      missingFeatures.push(key);
      continue;
    }
    const set = {};
    for (const field of FEATURE_FIELDS) {
      if (target[field] !== undefined && (current[field] ?? null) !== target[field])
        set[field] = target[field];
    }
    if (Object.keys(set).length) {
      featureUpdates.push({
        key,
        set,
        startsCharging: set.isPremium === true,
        becomesFree: set.isPremium === false,
      });
    }
  }

  const planCreates = [];
  const planUpdates = [];
  for (const target of PRICING_2026.plans) {
    const current = plans.find((p) => p.slug === target.slug);
    if (!current) {
      planCreates.push({ ...target, ...(target.promo ? { isActive: false } : {}) });
      continue;
    }
    const set = {};
    for (const field of PLAN_FIELDS) {
      if ((current[field] ?? null) !== (target[field] ?? null)) set[field] = target[field];
    }
    if (!sameList([...(current.features || [])].sort(), [...target.features].sort())) {
      set.features = target.features;
    }
    if (target.promo) {
      for (const field of ['kind', 'maxRedemptions', 'renewalPlanSlug']) {
        if ((current.promo?.[field] ?? null) !== (target.promo[field] ?? null)) {
          set[`promo.${field}`] = target.promo[field];
        }
      }
    } else if (!current.isActive) {
      set.isActive = true;
    }
    if (Object.keys(set).length) planUpdates.push({ slug: target.slug, set });
  }

  const catalogSlugs = new Set(PRICING_2026.plans.map((p) => p.slug));
  const oldPlans = plans
    .filter((p) => !catalogSlugs.has(p.slug) && p.isActive)
    .map((p) => ({ slug: p.slug, name: p.name, price: p.price, billingCycle: p.billingCycle }));

  return {
    featureUpdates,
    missingFeatures,
    planCreates,
    planUpdates,
    oldPlans,
    retire: retireOldPlans ? oldPlans.map((p) => p.slug) : [],
  };
};
