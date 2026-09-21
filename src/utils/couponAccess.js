import Coupon from '../models/Coupon.js';
import CouponRedemption from '../models/CouponRedemption.js';
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
 * Atomically increments a per-(coupon, user) counter, but only if it's still
 * under `perUserLimit` — a single-document `$inc` on the unique
 * (coupon, user) `CouponRedemption` row, which MongoDB serializes, so two
 * concurrent redemptions by the same user can't both read "under the limit"
 * (unlike `hasRedemptionsLeftForUser`'s `countDocuments`-then-act, which has
 * a race window). Returns true and leaves the counter incremented on
 * success; on failure, compensates by decrementing back to the pre-call
 * value and returns false. A brand-new (coupon, user) pair racing its very
 * first upsert can throw E11000 on the unique index — retried once, which
 * then finds the just-inserted row and increments normally.
 */
const incrementPerUserRedemption = async (couponId, userId, perUserLimit, _retried = false) => {
  if (!userId) return true;
  let row;
  try {
    row = await CouponRedemption.findOneAndUpdate(
      { coupon: couponId, user: userId },
      { $inc: { count: 1 } },
      { new: true, upsert: true },
    );
  } catch (error) {
    if (error?.code === 11000 && !_retried) {
      return incrementPerUserRedemption(couponId, userId, perUserLimit, true);
    }
    throw error;
  }
  if (row.count > perUserLimit) {
    await CouponRedemption.updateOne({ _id: row._id }, { $inc: { count: -1 } });
    return false;
  }
  return true;
};

/**
 * Atomically increments `coupon.redeemedCount`, but only if it's still under
 * `maxRedemptions` — the increment and the limit check happen as one
 * database operation, so two concurrent redemptions of a coupon on its last
 * remaining use can't both succeed (unlike a separate read-then-`$inc`,
 * which has a race window). Also atomically enforces `perUserLimit` via
 * `incrementPerUserRedemption` above, compensating the other counter if
 * either guard rejects the redemption. Returns the updated coupon on
 * success, or `null` if either limit was already reached. Callers must
 * treat `null` as "this redemption did not happen" — do not
 * activate/credit anything on a `null` return.
 */
export const redeemCoupon = async (couponId, userId, perUserLimit) => {
  const perUserOk = await incrementPerUserRedemption(couponId, userId, perUserLimit);
  if (!perUserOk) return null;

  const coupon = await Coupon.findOneAndUpdate(
    {
      _id: couponId,
      $or: [{ maxRedemptions: null }, { $expr: { $lt: ['$redeemedCount', '$maxRedemptions'] } }],
    },
    { $inc: { redeemedCount: 1 } },
    { new: true },
  );

  if (!coupon && userId) {
    await CouponRedemption.updateOne({ coupon: couponId, user: userId }, { $inc: { count: -1 } });
  }
  return coupon;
};

/**
 * The discount `coupon` applies to `amount` (in rupees, same unit as
 * SubscriptionPlan/SubscriptionFeature.price), clamped so the final amount
 * never goes below 0. Rounded to 2dp, the precision Cashfree's `order_amount`
 * accepts.
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
