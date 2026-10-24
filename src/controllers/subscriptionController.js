import SubscriptionFeature from '../models/SubscriptionFeature.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import Entitlement from '../models/Entitlement.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { createOrder, isPaymentConfigured, cashfreeMode } from '../utils/cashfreeClient.js';
import {
  getSettings,
  getUnlockedFeatureKeys,
  getLiveEntitlements,
  getUsageTier,
} from '../utils/subscriptionAccess.js';
import {
  FOUNDING_PROMO_KIND,
  PREMIUM_FAMILY,
  annualComparison,
  foundingEligibility,
  promoStatus,
  taxBreakdown,
} from '../utils/pricing.js';
import {
  SUBSCRIPTION_ORDER_PREFIX,
  activatePaidEntitlement,
  settleEntitlementOrder,
  settleRecentPendingOrders,
} from '../utils/subscriptionPurchase.js';
import { getUsageSummary } from '../utils/usageQuota.js';
import {
  resolveCoupon,
  hasRedemptionsLeftForUser,
  computeDiscount,
  redeemCoupon,
} from '../utils/couponAccess.js';
import logger from '../utils/logger.js';
import { memo } from '../utils/memoCache.js';

const fail = (status, message, extra = {}) =>
  Object.assign(new Error(message), { status, ...extra });

// Statuses that mean a purchase really happened (not pending or failed).
const PURCHASED_STATUSES = ['active', 'expired', 'cancelled', 'refunded'];

/**
 * Founding-member offer eligibility for `userId` (utils/pricing.js): the
 * offer must be live, and the user must never have paid for Premium or used
 * the offer, nor anyone else with the same phone number.
 */
const checkFoundingEligibility = async (plan, userId) => {
  const status = promoStatus(plan);
  if (!status.available || !userId) return foundingEligibility({ status });
  const familyPlanIds = (
    await SubscriptionPlan.find({ family: plan.family || PREMIUM_FAMILY }).select('_id')
  ).map((p) => p._id);
  const user = await User.findById(userId).select('phone');
  const samePhoneUserIds = user?.phone
    ? (await User.find({ phone: user.phone, _id: { $ne: userId } }).select('_id')).map((u) => u._id)
    : [];
  const [hadPaidPremium, usedFounding, phoneUsedFounding] = await Promise.all([
    Entitlement.exists({
      user: userId,
      source: 'plan',
      plan: { $in: familyPlanIds },
      status: { $in: PURCHASED_STATUSES },
      amount: { $gt: 0 },
    }),
    Entitlement.exists({
      user: userId,
      isFoundingOffer: true,
      status: { $in: PURCHASED_STATUSES },
    }),
    samePhoneUserIds.length
      ? Entitlement.exists({
          user: { $in: samePhoneUserIds },
          isFoundingOffer: true,
          status: { $in: PURCHASED_STATUSES },
        })
      : null,
  ]);
  return foundingEligibility({
    status,
    hadPaidPremium: Boolean(hadPaidPremium),
    usedFounding: Boolean(usedFounding),
    phoneUsedFounding: Boolean(phoneUsedFounding),
  });
};

/**
 * Resolves { source, planId, featureKey, billingCycle } to the item's live
 * list price, billing cycle, and the Entitlement fields that identify it —
 * shared by order creation and the coupon preview endpoint below so a
 * coupon always previews against the exact same price it will actually be
 * redeemed against. Refuses what the buyer can't or needn't buy: an
 * ineligible founding offer, or a feature their live plan already includes
 * (nobody pays twice for it). Throws { status, message, code } on failure.
 */
const resolvePurchasableItem = async (
  { source, planId, featureKey, billingCycle },
  settings,
  userId,
) => {
  if (!['plan', 'feature'].includes(source)) {
    throw fail(HTTP_STATUS.BAD_REQUEST, "source must be 'plan' or 'feature'");
  }

  if (source === 'plan') {
    if (!isValidObjectId(planId)) throw fail(HTTP_STATUS.BAD_REQUEST, 'A valid planId is required');
    const plan = await SubscriptionPlan.findOne({ _id: planId, isActive: true });
    if (!plan) throw fail(HTTP_STATUS.NOT_FOUND, 'Plan not found');

    const isFoundingOffer = plan.promo?.kind === FOUNDING_PROMO_KIND;
    if (plan.promo?.kind) {
      const eligibility = isFoundingOffer
        ? await checkFoundingEligibility(plan, userId)
        : foundingEligibility({ status: promoStatus(plan) });
      if (!eligibility.eligible) {
        throw fail(HTTP_STATUS.FORBIDDEN, 'This offer isn’t available for your account', {
          code: 'OFFER_NOT_ELIGIBLE',
          reason: eligibility.reason,
        });
      }
    }

    return {
      amount: plan.price,
      billingCycle: plan.billingCycle,
      isPromo: Boolean(plan.promo?.kind),
      entitlementFields: { source: 'plan', plan: plan._id, isFoundingOffer },
      notes: { source, planId: String(plan._id) },
    };
  }

  if (!settings.allowFeatureWisePurchase) {
    throw fail(
      HTTP_STATUS.BAD_REQUEST,
      'Individual feature purchases are disabled — choose a plan instead',
    );
  }
  if (!featureKey) throw fail(HTTP_STATUS.BAD_REQUEST, 'A featureKey is required');
  const feature = await SubscriptionFeature.findOne({
    key: String(featureKey).toLowerCase(),
    isActive: true,
  });
  if (!feature) throw fail(HTTP_STATUS.NOT_FOUND, 'Feature not found');
  if (!feature.isPremium) throw fail(HTTP_STATUS.BAD_REQUEST, 'This feature is already free');

  if (userId) {
    const live = await getLiveEntitlements(userId);
    const coveredByPlan = live.some(
      (e) => e.source === 'plan' && (e.plan?.features || []).includes(feature.key),
    );
    if (coveredByPlan) {
      throw fail(HTTP_STATUS.CONFLICT, 'Your plan already includes this feature', {
        code: 'ALREADY_INCLUDED',
      });
    }
  }

  const yearly = billingCycle === 'yearly';
  if (yearly && !(feature.yearlyPrice > 0)) {
    throw fail(HTTP_STATUS.BAD_REQUEST, 'This feature isn’t sold yearly');
  }
  return {
    amount: yearly ? feature.yearlyPrice : feature.price,
    billingCycle: yearly ? 'yearly' : feature.billingCycle,
    isPromo: false,
    entitlementFields: { source: 'feature', featureKey: feature.key },
    notes: { source, featureKey: feature.key },
  };
};

const sendItemError = (res, error) =>
  error.code
    ? res.status(error.status || HTTP_STATUS.BAD_REQUEST).json({
        success: false,
        statusCode: error.status || HTTP_STATUS.BAD_REQUEST,
        message: error.message,
        code: error.code,
        reason: error.reason,
      })
    : sendError(res, error.status || HTTP_STATUS.BAD_REQUEST, error.message);

/**
 * Validates `couponCode` (exists, active, unexpired, redemption limits) and
 * computes its discount against `amount`. Throws the same { status,
 * message } shape as resolvePurchasableItem so both callers can funnel
 * errors through one catch block.
 */
const applyCouponToAmount = async (couponCode, amount, userId) => {
  const coupon = await resolveCoupon(couponCode);
  if (!coupon) {
    throw Object.assign(new Error('This coupon code is invalid or has expired'), {
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }
  if (!(await hasRedemptionsLeftForUser(coupon, userId))) {
    throw Object.assign(new Error("You've already used this coupon the maximum number of times"), {
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }
  const { discountAmount, finalAmount } = computeDiscount(coupon, amount);
  return { coupon, discountAmount, finalAmount };
};

/** GET /api/subscriptions/plans — active bundles for the pricing/paywall screen. */
export const getPlans = async (req, res, next) => {
  try {
    // Same catalogue for everyone; cached for a minute, dropped on any
    // admin write (SubscriptionPlan's invalidateMemoOnWrite).
    const plans = await memo('subscriptions:plans', async () =>
      (await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 })).map((plan) =>
        plan.toJSON(),
      ),
    );
    return sendResponse(res, HTTP_STATUS.OK, 'Plans fetched', plans);
  } catch (error) {
    next(error);
  }
};

/** GET /api/subscriptions/features — active features with their current
 * free/premium status and price, so the app can render locks before ever
 * calling the real endpoint. */
export const getFeatures = async (req, res, next) => {
  try {
    const features = await memo('subscriptions:features', async () =>
      (
        await SubscriptionFeature.find({ isActive: true }).sort({
          category: 1,
          sortOrder: 1,
        })
      ).map((feature) => feature.toJSON()),
    );
    return sendResponse(res, HTTP_STATUS.OK, 'Features fetched', features);
  } catch (error) {
    next(error);
  }
};

/** The caller's live Premium plan, if any: the one that ends last. */
const premiumSummary = (entitlements) => {
  const plans = entitlements.filter(
    (e) => e.source === 'plan' && e.plan?.family === PREMIUM_FAMILY,
  );
  if (!plans.length) return { active: false };
  const latest = plans.reduce((a, b) =>
    !a.expiresAt || (b.expiresAt && b.expiresAt > a.expiresAt) ? b : a,
  );
  return {
    active: true,
    until: latest.expiresAt,
    planSlug: latest.plan.slug,
    billingCycle: latest.billingCycle,
    isFoundingOffer: Boolean(latest.isFoundingOffer),
    // Nothing renews by itself: the member buys again (renewalPlanSlug for a promo).
    autoRenews: false,
    renewalPlanSlug: latest.plan.promo?.renewalPlanSlug || latest.plan.slug,
  };
};

/** GET /api/subscriptions/me — the caller's own access summary: live
 * entitlements, unlocked feature keys, Premium status and this period's
 * fair-use usage. Recent unpaid orders are re-checked with Cashfree first,
 * so a payment whose confirmation got lost still shows up as active. */
export const getMySubscription = async (req, res, next) => {
  try {
    const settings = await getSettings();
    await settleRecentPendingOrders(req.userId);
    const entitlements = await getLiveEntitlements(req.userId);
    const unlocked = await getUnlockedFeatureKeys(req.userId);
    const tier = await getUsageTier(req.userId, settings);

    return sendResponse(res, HTTP_STATUS.OK, 'Subscription summary fetched', {
      subscriptionEnabled: settings.subscriptionEnabled,
      currency: settings.currency,
      entitlements,
      unlockedFeatureKeys: unlocked === 'ALL' ? 'ALL' : Array.from(unlocked),
      premium: premiumSummary(entitlements),
      usage: {
        tier,
        fairUseEnabled: Boolean(settings.fairUse?.enabled),
        items: await getUsageSummary({ userId: req.userId, fairUse: settings.fairUse, tier }),
      },
    });
  } catch (error) {
    next(error);
  }
};

const planCard = (plan) =>
  plan && {
    planId: plan._id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    price: plan.price,
    billingCycle: plan.billingCycle,
    badge: plan.badge,
  };

/**
 * GET /api/subscriptions/pricing — the one pricing summary the app's
 * My Subscription screen and the website's /pricing page both draw: Premium
 * monthly and yearly (with the yearly saving worked out here, not in each
 * client), the founding offer only while it's live (and, signed in, only if
 * the caller is eligible), add-ons with their monthly and yearly prices,
 * tax and fair-use limits. Public; prices come from the live database rows.
 */
export const getPricing = async (req, res, next) => {
  try {
    const settings = await getSettings();
    const { plans, features } = await memo('subscriptions:pricing', async () => ({
      plans: (await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 })).map((p) =>
        p.toJSON(),
      ),
      features: (
        await SubscriptionFeature.find({ isActive: true }).sort({ category: 1, sortOrder: 1 })
      ).map((f) => f.toJSON()),
    }));

    const premiumPlans = plans.filter((p) => p.family === PREMIUM_FAMILY);
    const regular = premiumPlans.filter((p) => !p.promo?.kind);
    const monthly = regular.find((p) => p.billingCycle === 'monthly');
    const yearly = regular.find((p) => p.billingCycle === 'yearly');
    const foundingPlan = premiumPlans.find((p) => p.promo?.kind === FOUNDING_PROMO_KIND);

    let founding = null;
    if (foundingPlan && promoStatus(foundingPlan).available) {
      const eligibility = req.userId
        ? await checkFoundingEligibility(foundingPlan, req.userId)
        : { eligible: true, reason: null };
      const renewal = plans.find((p) => p.slug === foundingPlan.promo.renewalPlanSlug) || yearly;
      if (eligibility.eligible) {
        founding = {
          ...planCard(foundingPlan),
          endsAt: foundingPlan.promo.endsAt,
          maxMembers: foundingPlan.promo.maxRedemptions,
          renewalPrice: renewal?.price ?? null,
          renewalBillingCycle: renewal?.billingCycle ?? 'yearly',
        };
      }
    }

    const premiumKeys = new Set(monthly?.features || yearly?.features || []);
    const featureName = Object.fromEntries(features.map((f) => [f.key, f.name]));

    return sendResponse(res, HTTP_STATUS.OK, 'Pricing fetched', {
      currency: settings.currency,
      subscriptionEnabled: settings.subscriptionEnabled,
      allowFeatureWisePurchase: settings.allowFeatureWisePurchase,
      tax: {
        ratePercent: settings.tax?.ratePercent ?? 18,
        pricesIncludeTax: settings.tax?.pricesIncludeTax !== false,
      },
      premium: {
        features: [...premiumKeys].map((key) => ({ key, name: featureName[key] || key })),
        monthly: planCard(monthly) || null,
        yearly: yearly
          ? {
              ...planCard(yearly),
              comparison: monthly ? annualComparison(monthly.price, yearly.price) : null,
            }
          : null,
        founding,
        autoRenews: false,
      },
      addOns: features
        .filter((f) => f.isPremium && f.price > 0)
        .map((f) => ({
          key: f.key,
          name: f.name,
          description: f.description,
          category: f.category,
          price: f.price,
          billingCycle: f.billingCycle,
          yearlyPrice: f.yearlyPrice ?? null,
          includedInPremium: premiumKeys.has(f.key),
        })),
      fairUse: {
        enabled: Boolean(settings.fairUse?.enabled),
        aiMessagesPerDay: settings.fairUse?.aiMessagesPerDay,
        documentsPerMonth: settings.fairUse?.documentsPerMonth,
        maxPagesPerDocument: settings.fairUse?.maxPagesPerDocument,
        doctorReportsPerMonth: settings.fairUse?.doctorReportsPerMonth,
      },
    });
  } catch (error) {
    next(error);
  }
};

// No pagination params on this endpoint's contract (the mobile "My
// Subscription" purchase-history list isn't paginated client-side either),
// so this is a flat cap rather than page/limit query params — comfortably
// above any real user's lifetime purchase count, just bounding the
// unbounded `.find()` that previously had no limit at all.
const HISTORY_HARD_CAP = 200;

/** GET /api/subscriptions/history — every past entitlement (any status), newest first. */
export const getHistory = async (req, res, next) => {
  try {
    const history = await Entitlement.find({ user: req.userId })
      .populate('plan')
      .sort({ createdAt: -1 })
      .limit(HISTORY_HARD_CAP);
    return sendResponse(res, HTTP_STATUS.OK, 'Purchase history fetched', history);
  } catch (error) {
    next(error);
  }
};

/** POST /api/subscriptions/coupons/apply — preview a coupon's discount
 * against a specific plan/feature before committing to a purchase. Creates
 * nothing; the mobile app calls this when the user taps "Apply", then
 * re-sends the same couponCode to /order, which re-validates independently
 * (never trust this preview alone — the discount is only real once /order
 * has redeemed it). */
export const previewCoupon = async (req, res, next) => {
  try {
    const { code, source, planId, featureKey, billingCycle } = req.body;
    if (!code || !String(code).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A coupon code is required');
    }

    const settings = await getSettings();
    let item;
    try {
      item = await resolvePurchasableItem(
        { source, planId, featureKey, billingCycle },
        settings,
        req.userId,
      );
    } catch (error) {
      return sendItemError(res, error);
    }
    if (item.isPromo) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Coupons can’t be used with this offer');
    }

    let applied;
    try {
      applied = await applyCouponToAmount(code, item.amount, req.userId);
    } catch (error) {
      return sendError(res, error.status || HTTP_STATUS.BAD_REQUEST, error.message);
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Coupon applied', {
      code: applied.coupon.code,
      discountType: applied.coupon.discountType,
      discountValue: applied.coupon.discountValue,
      originalAmount: item.amount,
      discountAmount: applied.discountAmount,
      finalAmount: taxBreakdown(applied.finalAmount, settings.tax).total,
      tax: taxBreakdown(applied.finalAmount, settings.tax),
      currency: settings.currency,
      free: applied.finalAmount <= 0,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/subscriptions/order — create a Cashfree order + a pending
 * Entitlement for either a plan or a single feature (`billingCycle:
 * 'yearly'` picks a feature's yearly price), optionally discounted by a
 * coupon. The amount charged is the price after coupon, plus GST only when
 * prices are set to exclude it. When a coupon brings the price to 0, no
 * Cashfree order is created at all — the Entitlement is activated
 * immediately and the response carries `free: true` so the app skips the
 * checkout sheet entirely (see PaywallModal.tsx). */
export const createSubscriptionOrder = async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings.subscriptionEnabled) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Subscriptions are currently disabled');
    }

    const { source, planId, featureKey, couponCode, billingCycle } = req.body;

    let item;
    try {
      item = await resolvePurchasableItem(
        { source, planId, featureKey, billingCycle },
        settings,
        req.userId,
      );
    } catch (error) {
      return sendItemError(res, error);
    }

    if (!item.amount || item.amount <= 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This item has no price configured');
    }
    if (couponCode && item.isPromo) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Coupons can’t be used with this offer');
    }

    let listAmount = item.amount;
    let coupon = null;
    let originalAmount;
    if (couponCode) {
      try {
        const applied = await applyCouponToAmount(couponCode, item.amount, req.userId);
        coupon = applied.coupon;
        originalAmount = item.amount;
        listAmount = applied.finalAmount;
      } catch (error) {
        return sendError(res, error.status || HTTP_STATUS.BAD_REQUEST, error.message);
      }
    }
    const amount = taxBreakdown(listAmount, settings.tax).total;

    const couponFields = coupon
      ? { coupon: coupon._id, couponCode: coupon.code, originalAmount }
      : {};

    // 100%-off (or a flat coupon >= the price): activate straight away,
    // Cashfree never enters the picture — there's nothing to pay.
    if (amount <= 0) {
      // Redeem atomically *before* creating the Entitlement — applyCouponToAmount's
      // earlier check is only advisory (read-then-act), so a concurrent redemption
      // could have exhausted the coupon in between. Re-validating here, and only
      // creating the Entitlement once the atomic redemption actually succeeds,
      // avoids both the double-credit race and an orphaned Entitlement.
      if (coupon) {
        const redeemed = await redeemCoupon(coupon._id, req.userId, coupon.perUserLimit);
        if (!redeemed) {
          return sendError(
            res,
            HTTP_STATUS.BAD_REQUEST,
            "You've already used this coupon the maximum number of times",
          );
        }
      }

      const pending = await Entitlement.create({
        user: req.userId,
        ...item.entitlementFields,
        status: 'pending',
        amount: 0,
        currency: settings.currency,
        billingCycle: item.billingCycle,
      });
      // The coupon was redeemed above, so activation must not count it again.
      const entitlement = await activatePaidEntitlement(pending);
      if (coupon && entitlement) {
        await Entitlement.updateOne({ _id: entitlement._id }, { $set: couponFields });
      }

      logger.info('subscription_free_redemption', {
        action: 'subscription_free_redemption',
        userId: req.userId,
        source,
        entitlementId: pending._id,
        couponCode: coupon?.code,
      });

      return sendResponse(res, HTTP_STATUS.CREATED, 'Unlocked for free', {
        entitlementId: pending._id,
        free: true,
        amount: 0,
        currency: settings.currency,
      });
    }

    if (!isPaymentConfigured()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Payments are not configured on the server',
      );
    }

    const entitlement = await Entitlement.create({
      user: req.userId,
      ...item.entitlementFields,
      ...couponFields,
      status: 'pending',
      amount,
      currency: settings.currency,
      billingCycle: item.billingCycle,
    });

    const user = await User.findById(req.userId);
    // Cashfree order ids must be unique per order — an entitlement can only
    // ever have one pending order at a time in practice, but a random suffix
    // keeps a retried purchase attempt from colliding with itself. The
    // `sub_` prefix routes Cashfree's webhook here (see subscriptionPurchase.js).
    const cashfreeOrderId = `${SUBSCRIPTION_ORDER_PREFIX}${entitlement._id}_${Date.now().toString(36)}`;

    let order;
    try {
      order = await createOrder({
        orderId: cashfreeOrderId,
        amount,
        currency: settings.currency,
        customer: { id: req.userId, name: user?.name, email: user?.email, phone: user?.phone },
        notes: {
          ...item.notes,
          userId: String(req.userId),
          entitlementId: String(entitlement._id),
          couponCode: coupon?.code,
        },
      });
    } catch (error) {
      // Cashfree down/timeout after the Entitlement was already persisted —
      // clean it up rather than leaving a permanently 'pending' row with no
      // cashfreeOrderId (DB clutter and a support dead-end: "I tried to pay
      // and nothing happened").
      await Entitlement.deleteOne({ _id: entitlement._id });
      logger.error('subscription_order_create_failed', {
        action: 'subscription_order_create_failed',
        userId: req.userId,
        entitlementId: entitlement._id,
        error: error.message,
      });
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Could not start payment right now — please try again shortly',
      );
    }

    entitlement.cashfreeOrderId = order.order_id;
    await entitlement.save();

    logger.info('subscription_order_created', {
      action: 'subscription_order_created',
      userId: req.userId,
      source,
      entitlementId: entitlement._id,
      orderId: order.order_id,
      amount,
      couponCode: coupon?.code,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Payment order created', {
      entitlementId: entitlement._id,
      free: false,
      orderId: order.order_id,
      amount,
      tax: taxBreakdown(listAmount, settings.tax),
      currency: settings.currency,
      paymentSessionId: order.payment_session_id,
      cashfreeMode: cashfreeMode(),
    });
  } catch (error) {
    logger.error('subscription_order_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** POST /api/subscriptions/verify — verify a completed Cashfree checkout
 * and, only once Cashfree confirms the order was actually paid, activate
 * the Entitlement. The webhook does the same if the app never gets here. */
export const verifySubscriptionPayment = async (req, res, next) => {
  try {
    const { entitlementId, orderId } = req.body;

    if (!isValidObjectId(entitlementId) || !orderId) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Missing payment verification fields');
    }

    const entitlement = await Entitlement.findOne({
      _id: entitlementId,
      user: req.userId,
      cashfreeOrderId: orderId,
    });
    if (!entitlement) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Purchase order not found');

    if (entitlement.status === 'active') {
      await entitlement.populate('plan');
      return sendResponse(res, HTTP_STATUS.OK, 'Already active', entitlement);
    }

    const { outcome, entitlement: settled } = await settleEntitlementOrder(entitlement);
    if (outcome === 'pending') {
      return sendResponse(res, HTTP_STATUS.ACCEPTED, 'Payment still pending', { pending: true });
    }
    if (outcome === 'active') {
      return sendResponse(res, HTTP_STATUS.CREATED, 'Purchase activated', settled);
    }
    logger.error('subscription_payment_verify_failed', {
      action: 'subscription_payment_verify_failed',
      userId: req.userId,
      entitlementId,
      outcome,
    });
    return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Payment verification failed');
  } catch (error) {
    logger.error('subscription_verify_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
