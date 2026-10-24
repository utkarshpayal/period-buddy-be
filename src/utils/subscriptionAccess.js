import SubscriptionSettings from '../models/SubscriptionSettings.js';
import SubscriptionFeature from '../models/SubscriptionFeature.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import Entitlement from '../models/Entitlement.js';
import { expiryFrom, resolveUnlockedKeys, usageTier } from './pricing.js';

/**
 * The subscription system is a singleton row: read/write it only through
 * this getter so callers never have to think about first-run seeding. The
 * seeder (utils/seeder.js) also creates one at startup, but this is the
 * belt-and-suspenders path for a fresh/unseeded database.
 */
export const getSettings = async () => {
  let settings = await SubscriptionSettings.findOne();
  if (!settings) {
    settings = await SubscriptionSettings.create({});
  }
  return settings;
};

/** A user's entitlements that are active and unexpired, plans populated. */
export const getLiveEntitlements = async (userId, now = new Date()) =>
  Entitlement.find({
    user: userId,
    status: 'active',
    $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
  }).populate('plan');

/**
 * Feature keys `userId` currently has unrestricted access to: any feature
 * an admin has taken off the paywall (isPremium: false — always free, same
 * rule hasFeatureAccess below applies) plus anything covered by an active,
 * unexpired Entitlement (direct feature purchase, or membership in a plan
 * that includes it). Returns the sentinel string 'ALL' when the global
 * subscription switch is off — every route should treat that as
 * "everything unlocked" rather than iterating features.
 *
 * This is also what GET /api/subscriptions/me hands the mobile app to build
 * its cached hasAccess() check — it has to agree with hasFeatureAccess's
 * own free pass for non-premium features, or the app keeps showing a
 * paywall for a feature an admin just made free. The rule itself is
 * utils/pricing.js#resolveUnlockedKeys (unit-tested).
 *
 * @returns {Promise<'ALL'|Set<string>>}
 */
export const getUnlockedFeatureKeys = async (userId) => {
  const settings = await getSettings();
  if (!settings.subscriptionEnabled) return 'ALL';

  const freeFeatures = await SubscriptionFeature.find({
    isActive: true,
    isPremium: false,
  }).select('key');
  const entitlements = userId ? await getLiveEntitlements(userId) : [];
  return resolveUnlockedKeys({
    subscriptionEnabled: true,
    freeKeys: freeFeatures.map((f) => f.key),
    entitlements,
  });
};

/** 'premium' or 'free', for fair-use limits (utils/pricing.js#usageTier). */
export const getUsageTier = async (userId, settings) => {
  const resolved = settings || (await getSettings());
  if (!resolved.subscriptionEnabled) return 'premium';
  return usageTier({ subscriptionEnabled: true, entitlements: await getLiveEntitlements(userId) });
};

/**
 * Whether `userId` can use `featureKey` right now. A feature that doesn't
 * exist in the catalog, or exists but isn't marked `isPremium`, is always
 * accessible — unknown/free keys never block a request. This is what makes
 * shipping the gating middleware safe by default: nothing locks until an
 * admin both creates the feature row *and* flips it to premium.
 */
export const hasFeatureAccess = async (userId, featureKey) => {
  const feature = await SubscriptionFeature.findOne({ key: featureKey, isActive: true });
  if (!feature || !feature.isPremium) return true;

  const unlocked = await getUnlockedFeatureKeys(userId);
  if (unlocked === 'ALL') return true;
  return unlocked.has(featureKey);
};

/**
 * Full lock payload for a blocked feature — everything the mobile paywall
 * needs to render without a second round trip (the feature's own price plus
 * any active plan that would also unlock it).
 */
export const getFeatureLockPayload = async (featureKey) => {
  const feature = await SubscriptionFeature.findOne({ key: featureKey, isActive: true });
  // Promo plans (the founding offer) are offered only on the pricing screen,
  // where the buyer's eligibility is checked (GET /api/subscriptions/pricing).
  const plans = await SubscriptionPlan.find({
    isActive: true,
    features: featureKey,
    'promo.kind': { $in: [null, ''] },
  }).sort({ sortOrder: 1 });

  return {
    code: 'FEATURE_LOCKED',
    feature: feature
      ? {
          key: feature.key,
          name: feature.name,
          description: feature.description,
          price: feature.price,
          billingCycle: feature.billingCycle,
        }
      : { key: featureKey, name: featureKey },
    plans: plans.map((plan) => ({
      _id: plan._id,
      name: plan.name,
      slug: plan.slug,
      price: plan.price,
      billingCycle: plan.billingCycle,
      badge: plan.badge,
    })),
  };
};

/** monthly -> +30d, yearly -> +365d, one_time -> never expires. */
export const computeExpiryFromCycle = (billingCycle, from = new Date()) =>
  expiryFrom(billingCycle, from);
