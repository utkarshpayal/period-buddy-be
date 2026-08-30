import mongoose from 'mongoose';

// Admin-defined discount code, redeemable against any plan or feature
// purchase in subscriptionController.createSubscriptionOrder. Deliberately
// not scoped to specific plans/features — it's a store-wide discount, same
// as most simple coupon systems; scope narrowing can be added later without
// a schema change if it's ever needed.
const couponSchema = new mongoose.Schema(
  {
    // Always matched uppercase (see couponAccess.js#resolveCoupon) so admins
    // and users never have to think about case.
    code: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      uppercase: true,
      match: [/^[A-Z0-9_-]{3,32}$/, 'Code must be 3-32 characters: letters, numbers, - or _'],
    },
    description: { type: String, trim: true },

    discountType: { type: String, enum: ['percentage', 'flat'], required: true },
    // percentage: 1-100. flat: a currency amount, capped to the item's price
    // at redemption time (couponAccess.js#computeDiscount) so a coupon can
    // never make an order go negative.
    discountValue: { type: Number, required: true, min: 0 },

    isActive: { type: Boolean, default: true },
    // null = never expires.
    expiresAt: { type: Date, default: null },

    // null = unlimited total redemptions across all users.
    maxRedemptions: { type: Number, default: null, min: 1 },
    // Incremented only on a confirmed redemption (payment verified, or
    // immediately for a 100%-off free redemption) — never on an abandoned
    // pending order, so this stays an accurate "times actually used" count.
    redeemedCount: { type: Number, default: 0, min: 0 },
    // How many times one user may redeem this same code. Default 1 — the
    // common case for a promo code; raise it for a reusable/loyalty code.
    perUserLimit: { type: Number, default: 1, min: 1 },
  },
  { timestamps: true },
);

couponSchema.index({ isActive: 1 });

couponSchema.pre('validate', function validatePercentage(next) {
  if (this.discountType === 'percentage' && this.discountValue > 100) {
    return next(new Error('A percentage discount cannot exceed 100'));
  }
  next();
});

export default mongoose.model('Coupon', couponSchema);
