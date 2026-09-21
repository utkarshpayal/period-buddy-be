import mongoose from 'mongoose';

// Per-(coupon, user) redemption counter, separate from Coupon.redeemedCount
// (the store-wide total). Exists solely so couponAccess.js#redeemCoupon can
// enforce Coupon.perUserLimit atomically via a single-document `$inc` —
// MongoDB serializes concurrent writes to the same document, so two
// concurrent redemption attempts by the same user can never both read
// "under the limit" the way a countDocuments()-then-act check could.
const couponRedemptionSchema = new mongoose.Schema(
  {
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

couponRedemptionSchema.index({ coupon: 1, user: 1 }, { unique: true });

export default mongoose.model('CouponRedemption', couponRedemptionSchema);
