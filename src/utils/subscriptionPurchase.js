import Entitlement from '../models/Entitlement.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import Coupon from '../models/Coupon.js';
import { getOrderStatus, getRefund } from './cashfreeClient.js';
import { getLiveEntitlements } from './subscriptionAccess.js';
import { accessStart, expiryFrom } from './pricing.js';
import { redeemCoupon } from './couponAccess.js';
import logger from './logger.js';

// What happens to a subscription order after checkout: activation once
// Cashfree says it's paid, failure, and refund. Shared by the app's
// /api/subscriptions/verify, the Cashfree webhook (one URL for all orders,
// see consultationController.cashfreeConsultationWebhook) and the re-check
// GET /api/subscriptions/me runs for recent unpaid orders. Every path re-reads
// the order from Cashfree and claims the entitlement with one atomic update,
// so duplicate webhooks, retries and concurrent verifies activate it once.

export const SUBSCRIPTION_ORDER_PREFIX = 'sub_';

/**
 * Turns a paid, pending entitlement active. Access starts when the buyer's
 * current access to the same thing ends (renewing early extends it). Returns
 * the activated entitlement, or null if another call already did it (or it
 * was refunded/cancelled meanwhile).
 */
export const activatePaidEntitlement = async (entitlement, now = new Date()) => {
  const plan =
    entitlement.source === 'plan' ? await SubscriptionPlan.findById(entitlement.plan) : null;
  const live = (await getLiveEntitlements(entitlement.user, now)).filter(
    (e) => String(e._id) !== String(entitlement._id),
  );
  const start = accessStart(
    live,
    {
      family: plan?.family || null,
      featureKey: entitlement.source === 'feature' ? entitlement.featureKey : null,
    },
    now,
  );

  const claimed = await Entitlement.findOneAndUpdate(
    { _id: entitlement._id, status: { $in: ['pending', 'failed'] } },
    {
      $set: {
        status: 'active',
        startedAt: start,
        expiresAt: expiryFrom(entitlement.billingCycle, start),
      },
    },
    { new: true },
  ).populate('plan');
  if (!claimed) return null;

  // Counted once, only by the call that won the claim above.
  if (claimed.coupon) {
    const couponDoc = await Coupon.findById(claimed.coupon).select('perUserLimit');
    const redeemed =
      couponDoc && (await redeemCoupon(claimed.coupon, claimed.user, couponDoc.perUserLimit));
    if (!redeemed) {
      logger.warn('subscription_coupon_redeem_limit_race', {
        action: 'subscription_coupon_redeem_limit_race',
        entitlementId: claimed._id,
        couponId: claimed.coupon,
      });
    }
  }
  if (claimed.isFoundingOffer && plan) {
    await SubscriptionPlan.updateOne({ _id: plan._id }, { $inc: { 'promo.redeemedCount': 1 } });
  }

  logger.info('subscription_purchased', {
    action: 'subscription_purchased',
    userId: claimed.user,
    entitlementId: claimed._id,
    source: claimed.source,
    featureKey: claimed.featureKey,
    planId: plan?._id,
    amount: claimed.amount,
    couponCode: claimed.couponCode,
    foundingOffer: claimed.isFoundingOffer || undefined,
    orderId: claimed.cashfreeOrderId,
  });
  return claimed;
};

/**
 * Re-reads a pending entitlement's order from Cashfree and settles it.
 * @returns {Promise<{ outcome: 'active'|'pending'|'failed'|'unchanged', entitlement }>}
 */
export const settleEntitlementOrder = async (entitlement) => {
  if (entitlement.status === 'active') return { outcome: 'active', entitlement };
  if (entitlement.status !== 'pending' || !entitlement.cashfreeOrderId) {
    return { outcome: 'unchanged', entitlement };
  }
  const order = await getOrderStatus(entitlement.cashfreeOrderId);

  // 'ACTIVE' = still open (e.g. a UPI request not yet approved): not a failure.
  if (order.order_status === 'ACTIVE') return { outcome: 'pending', entitlement };

  if (order.order_status === 'PAID') {
    const activated = await activatePaidEntitlement(entitlement);
    if (activated) return { outcome: 'active', entitlement: activated };
    const current = await Entitlement.findById(entitlement._id).populate('plan');
    return { outcome: current?.status === 'active' ? 'active' : 'unchanged', entitlement: current };
  }

  await Entitlement.updateOne(
    { _id: entitlement._id, status: 'pending' },
    { $set: { status: 'failed' } },
  );
  logger.warn('subscription_payment_failed', {
    action: 'subscription_payment_failed',
    entitlementId: entitlement._id,
    orderStatus: order.order_status,
  });
  return { outcome: 'failed', entitlement };
};

/** Webhook: a subscription order changed. Unknown orders are ignored. */
export const handleSubscriptionOrderWebhook = async (orderId) => {
  const entitlement = await Entitlement.findOne({ cashfreeOrderId: orderId });
  if (!entitlement) return 'ignored';
  return (await settleEntitlementOrder(entitlement)).outcome;
};

/**
 * Webhook: a refund on a subscription order. The refund is re-read from
 * Cashfree; a successful refund of the full amount ends that purchase's
 * access. A partial refund is only logged, for a person to decide.
 */
export const handleSubscriptionRefundWebhook = async (payload) => {
  const orderId = payload?.data?.refund?.order_id;
  const refundId = payload?.data?.refund?.refund_id;
  if (typeof orderId !== 'string' || !refundId) return 'ignored';
  const entitlement = await Entitlement.findOne({ cashfreeOrderId: orderId });
  if (!entitlement) return 'ignored';

  const refund = await getRefund({ orderId, refundId });
  if (refund?.refund_status !== 'SUCCESS') return 'not_settled';
  if (Number(refund.refund_amount) < entitlement.amount) {
    logger.warn('subscription_partial_refund', {
      action: 'subscription_partial_refund',
      entitlementId: entitlement._id,
      refundAmount: refund.refund_amount,
      amount: entitlement.amount,
    });
    return 'partial';
  }
  const updated = await Entitlement.findOneAndUpdate(
    { _id: entitlement._id, status: { $ne: 'refunded' } },
    { $set: { status: 'refunded', refundedAt: new Date() } },
  );
  if (updated) {
    logger.info('subscription_refunded', {
      action: 'subscription_refunded',
      entitlementId: entitlement._id,
      userId: entitlement.user,
    });
  }
  return updated ? 'refunded' : 'unchanged';
};

/** Recent unpaid orders of a user, re-checked so a payment whose
 * confirmation got lost still activates (same idea as the consultation list). */
export const settleRecentPendingOrders = async (userId, now = new Date()) => {
  const pending = await Entitlement.find({
    user: userId,
    status: 'pending',
    cashfreeOrderId: { $exists: true },
    createdAt: { $gte: new Date(now.getTime() - 2 * 60 * 60000) },
  }).limit(5);
  for (const entitlement of pending) {
    try {
      await settleEntitlementOrder(entitlement);
    } catch (error) {
      logger.warn('subscription_settle_failed', {
        action: 'subscription_settle_failed',
        entitlementId: entitlement._id,
        error: error.message,
      });
    }
  }
};
