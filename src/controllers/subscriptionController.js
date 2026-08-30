import SubscriptionFeature from '../models/SubscriptionFeature.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import Entitlement from '../models/Entitlement.js';
import Coupon from '../models/Coupon.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { createOrder, verifySignature, isPaymentConfigured } from '../utils/razorpayClient.js';
import {
  getSettings,
  getUnlockedFeatureKeys,
  computeExpiryFromCycle,
} from '../utils/subscriptionAccess.js';
import {
  resolveCoupon,
  hasRedemptionsLeftForUser,
  computeDiscount,
} from '../utils/couponAccess.js';
import logger from '../utils/logger.js';

/**
 * Resolves { source, planId, featureKey } to the item's live base price,
 * billing cycle, and the Entitlement fields that identify it — shared by
 * order creation and the coupon preview endpoint below so a coupon always
 * previews against the exact same price it will actually be redeemed
 * against. Throws { status, message } on any validation failure.
 */
const resolvePurchasableItem = async ({ source, planId, featureKey }, settings) => {
  if (!['plan', 'feature'].includes(source)) {
    throw Object.assign(new Error("source must be 'plan' or 'feature'"), {
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }

  if (source === 'plan') {
    if (!isValidObjectId(planId)) {
      throw Object.assign(new Error('A valid planId is required'), {
        status: HTTP_STATUS.BAD_REQUEST,
      });
    }
    const plan = await SubscriptionPlan.findOne({ _id: planId, isActive: true });
    if (!plan) throw Object.assign(new Error('Plan not found'), { status: HTTP_STATUS.NOT_FOUND });

    return {
      amount: plan.price,
      billingCycle: plan.billingCycle,
      entitlementFields: { source: 'plan', plan: plan._id },
      notes: { source, planId: String(plan._id) },
    };
  }

  if (!settings.allowFeatureWisePurchase) {
    throw Object.assign(
      new Error('Individual feature purchases are disabled — choose a plan instead'),
      { status: HTTP_STATUS.BAD_REQUEST },
    );
  }
  if (!featureKey) {
    throw Object.assign(new Error('A featureKey is required'), { status: HTTP_STATUS.BAD_REQUEST });
  }
  const feature = await SubscriptionFeature.findOne({
    key: String(featureKey).toLowerCase(),
    isActive: true,
  });
  if (!feature)
    throw Object.assign(new Error('Feature not found'), { status: HTTP_STATUS.NOT_FOUND });
  if (!feature.isPremium) {
    throw Object.assign(new Error('This feature is already free'), {
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }

  return {
    amount: feature.price,
    billingCycle: feature.billingCycle,
    entitlementFields: { source: 'feature', featureKey: feature.key },
    notes: { source, featureKey: feature.key },
  };
};

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
    const plans = await SubscriptionPlan.find({ isActive: true }).sort({ sortOrder: 1 });
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
    const features = await SubscriptionFeature.find({ isActive: true }).sort({
      category: 1,
      sortOrder: 1,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Features fetched', features);
  } catch (error) {
    next(error);
  }
};

/** GET /api/subscriptions/me — the caller's own access summary. */
export const getMySubscription = async (req, res, next) => {
  try {
    const settings = await getSettings();
    const now = new Date();
    const entitlements = await Entitlement.find({
      user: req.userId,
      status: 'active',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    }).populate('plan');

    const unlocked = await getUnlockedFeatureKeys(req.userId);

    return sendResponse(res, HTTP_STATUS.OK, 'Subscription summary fetched', {
      subscriptionEnabled: settings.subscriptionEnabled,
      currency: settings.currency,
      entitlements,
      unlockedFeatureKeys: unlocked === 'ALL' ? 'ALL' : Array.from(unlocked),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/subscriptions/history — every past entitlement (any status), newest first. */
export const getHistory = async (req, res, next) => {
  try {
    const history = await Entitlement.find({ user: req.userId })
      .populate('plan')
      .sort({ createdAt: -1 });
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
    const { code, source, planId, featureKey } = req.body;
    if (!code || !String(code).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A coupon code is required');
    }

    const settings = await getSettings();
    let item;
    try {
      item = await resolvePurchasableItem({ source, planId, featureKey }, settings);
    } catch (error) {
      return sendError(res, error.status || HTTP_STATUS.BAD_REQUEST, error.message);
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
      finalAmount: applied.finalAmount,
      currency: settings.currency,
      free: applied.finalAmount <= 0,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/subscriptions/order — create a Razorpay order + a pending
 * Entitlement for either a plan or a single feature, optionally discounted
 * by a coupon. When a coupon brings the price to 0, no Razorpay order is
 * created at all — the Entitlement is activated immediately and the
 * response carries `free: true` so the app skips the checkout sheet
 * entirely (see PaywallModal.tsx). */
export const createSubscriptionOrder = async (req, res, next) => {
  try {
    const settings = await getSettings();
    if (!settings.subscriptionEnabled) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Subscriptions are currently disabled');
    }

    const { source, planId, featureKey, couponCode } = req.body;

    let item;
    try {
      item = await resolvePurchasableItem({ source, planId, featureKey }, settings);
    } catch (error) {
      return sendError(res, error.status || HTTP_STATUS.BAD_REQUEST, error.message);
    }

    if (!item.amount || item.amount <= 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This item has no price configured');
    }

    let amount = item.amount;
    let coupon = null;
    let originalAmount;
    if (couponCode) {
      try {
        const applied = await applyCouponToAmount(couponCode, item.amount, req.userId);
        coupon = applied.coupon;
        originalAmount = item.amount;
        amount = applied.finalAmount;
      } catch (error) {
        return sendError(res, error.status || HTTP_STATUS.BAD_REQUEST, error.message);
      }
    }

    const couponFields = coupon
      ? { coupon: coupon._id, couponCode: coupon.code, originalAmount }
      : {};

    // 100%-off (or a flat coupon >= the price): activate straight away,
    // Razorpay never enters the picture — there's nothing to pay.
    if (amount <= 0) {
      const now = new Date();
      const entitlement = await Entitlement.create({
        user: req.userId,
        ...item.entitlementFields,
        ...couponFields,
        status: 'active',
        amount: 0,
        currency: settings.currency,
        billingCycle: item.billingCycle,
        startedAt: now,
        expiresAt: computeExpiryFromCycle(item.billingCycle, now),
      });

      if (coupon) {
        await Coupon.updateOne({ _id: coupon._id }, { $inc: { redeemedCount: 1 } });
      }

      logger.info('subscription_free_redemption', {
        action: 'subscription_free_redemption',
        userId: req.userId,
        source,
        entitlementId: entitlement._id,
        couponCode: coupon?.code,
      });

      return sendResponse(res, HTTP_STATUS.CREATED, 'Unlocked for free', {
        entitlementId: entitlement._id,
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

    const order = await createOrder({
      amountMinorUnits: Math.round(amount * 100),
      currency: settings.currency,
      receipt: String(entitlement._id),
      notes: {
        ...item.notes,
        userId: String(req.userId),
        entitlementId: String(entitlement._id),
        couponCode: coupon?.code,
      },
    });

    entitlement.razorpayOrderId = order.id;
    await entitlement.save();

    logger.info('subscription_order_created', {
      action: 'subscription_order_created',
      userId: req.userId,
      source,
      entitlementId: entitlement._id,
      orderId: order.id,
      amount,
      couponCode: coupon?.code,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Payment order created', {
      entitlementId: entitlement._id,
      free: false,
      orderId: order.id,
      amount: order.amount,
      currency: order.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (error) {
    logger.error('subscription_order_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** POST /api/subscriptions/verify — verify a completed Razorpay checkout and,
 * only on a valid signature, activate the Entitlement. */
export const verifySubscriptionPayment = async (req, res, next) => {
  try {
    const { entitlementId, razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;

    if (
      !isValidObjectId(entitlementId) ||
      !razorpay_order_id ||
      !razorpay_payment_id ||
      !razorpay_signature
    ) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Missing payment verification fields');
    }

    const entitlement = await Entitlement.findOne({
      _id: entitlementId,
      user: req.userId,
      razorpayOrderId: razorpay_order_id,
    });
    if (!entitlement) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Purchase order not found');

    if (entitlement.status === 'active') {
      await entitlement.populate('plan');
      return sendResponse(res, HTTP_STATUS.OK, 'Already active', entitlement);
    }

    const isValid = verifySignature({
      orderId: razorpay_order_id,
      paymentId: razorpay_payment_id,
      signature: razorpay_signature,
    });

    if (!isValid) {
      entitlement.status = 'failed';
      await entitlement.save();
      logger.error('subscription_payment_verify_failed', {
        action: 'subscription_payment_verify_failed',
        userId: req.userId,
        entitlementId,
      });
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Payment verification failed');
    }

    const now = new Date();
    const expiresAt = computeExpiryFromCycle(entitlement.billingCycle, now);

    // Atomically claim pending -> active, same concurrency guard used by
    // consultationController.verifyConsultationPayment: only the first of
    // any concurrent /verify calls for this entitlement matches.
    const claimed = await Entitlement.findOneAndUpdate(
      { _id: entitlement._id, status: { $ne: 'active' } },
      {
        $set: {
          status: 'active',
          startedAt: now,
          expiresAt,
          razorpayPaymentId: razorpay_payment_id,
        },
      },
      { new: true },
    ).populate('plan');

    // Only counts once — findOneAndUpdate above only matches on the first
    // of any concurrent /verify calls, so a retried/duplicate call (which
    // lands on the `entitlement.status === 'active'` early return instead)
    // never double-increments this.
    if (claimed && entitlement.coupon) {
      await Coupon.updateOne({ _id: entitlement.coupon }, { $inc: { redeemedCount: 1 } });
    }

    logger.info('subscription_purchased', {
      action: 'subscription_purchased',
      userId: req.userId,
      entitlementId: entitlement._id,
      source: entitlement.source,
      featureKey: entitlement.featureKey,
      planId: entitlement.plan,
      amount: entitlement.amount,
      couponCode: entitlement.couponCode,
      paymentId: razorpay_payment_id,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Purchase activated', claimed || entitlement);
  } catch (error) {
    logger.error('subscription_verify_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
