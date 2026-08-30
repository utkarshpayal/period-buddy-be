import Coupon from '../models/Coupon.js';
import Entitlement from '../models/Entitlement.js';

/**
 * Look up an active, unexpired coupon by code (case-insensitive — codes are
 * always stored/matched uppercase). Returns null rather than throwing so
 * callers can turn a miss into their own friendly error message.
 */
export const resolveCoupon = async (code) => {
  if (!code || !String(code).trim()) return null;
  const coupon = await Coupon.findOne({
    code: String(code).trim().toUpperCase(),
    isActive: true,
  });
  if (!coupon) return null;
  if (coupon.expiresAt && coupon.expiresAt <= new Date()) return null;
  if (coupon.maxRedemptions !== null && coupon.redeemedCount >= coupon.maxRedemptions) return null;
  return coupon;
};

/**
 * Whether `userId` still has redemptions left on `coupon`, per its
 * perUserLimit. Counts 'active' Entitlements only — an abandoned 'pending'
 * or a 'failed' order doesn't consume the user's allowance.
 */
export const hasRedemptionsLeftForUser = async (coupon, userId) => {
  if (!userId) return true;
  const usedByUser = await Entitlement.countDocuments({
    user: userId,
    coupon: coupon._id,
    status: 'active',
  });
  return usedByUser < coupon.perUserLimit;
};

/**
 * The discount `coupon` applies to `amount` (in rupees, same unit as
 * SubscriptionPlan/SubscriptionFeature.price), clamped so the final amount
 * never goes below 0. Rounded to paise (2dp) since that's what Razorpay's
 * minor-unit conversion (`Math.round(amount * 100)`) ultimately needs to be
 * a whole number of.
 */
export const computeDiscount = (coupon, amount) => {
  const raw =
    coupon.discountType === 'percentage'
      ? (amount * coupon.discountValue) / 100
      : coupon.discountValue;
  const discountAmount = Math.round(Math.min(Math.max(raw, 0), amount) * 100) / 100;
  const finalAmount = Math.round((amount - discountAmount) * 100) / 100;
  return { discountAmount, finalAmount };
};
