import mongoose from 'mongoose';

// One purchase (or admin grant) of paid access — either a whole
// SubscriptionPlan or a single SubscriptionFeature. `status` lifecycle
// mirrors Consultation's paymentStatus pattern: 'pending' is created
// alongside the Razorpay order, then 'active'/'failed' is set by /verify.
// A user can hold several active Entitlements at once (e.g. one plan plus
// one extra à la carte feature bought later) — subscriptionAccess.js unions
// all of them.
const entitlementSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    source: { type: String, enum: ['plan', 'feature'], required: true },

    // Exactly one of these is set, matching `source`.
    plan: { type: mongoose.Schema.Types.ObjectId, ref: 'SubscriptionPlan' },
    featureKey: { type: String, trim: true, lowercase: true },

    status: {
      type: String,
      enum: ['pending', 'active', 'expired', 'cancelled', 'failed'],
      default: 'pending',
      index: true,
    },

    startedAt: { type: Date },
    // null = never expires (a one_time purchase of a feature/plan that isn't
    // period-bound).
    expiresAt: { type: Date, default: null },

    // The amount actually charged (post-coupon, if any) — 0 for a 100%-off
    // coupon redemption, which skips Razorpay entirely (see
    // subscriptionController.createSubscriptionOrder).
    amount: { type: Number, required: true, min: 0 },
    currency: { type: String, default: 'INR' },
    // Captured from the plan/feature at purchase time (not read live from it
    // at renewal/expiry-calc time), so a later admin price/cycle edit never
    // retroactively changes an already-purchased entitlement's expiry math.
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly', 'one_time'],
      required: true,
    },

    // Set only when a coupon was applied. `couponCode`/`originalAmount` are
    // denormalized snapshots (kept even if the Coupon doc is later edited or
    // deleted) so purchase history/revenue reporting stays accurate.
    coupon: { type: mongoose.Schema.Types.ObjectId, ref: 'Coupon', default: null },
    couponCode: { type: String, trim: true, uppercase: true },
    originalAmount: { type: Number, min: 0 },

    razorpayOrderId: { type: String, trim: true },
    razorpayPaymentId: { type: String, trim: true },

    // True for access an admin comped manually rather than a real purchase
    // (support gestures, promos) — kept distinct for revenue reporting.
    grantedByAdmin: { type: Boolean, default: false },
  },
  { timestamps: true },
);

entitlementSchema.index({ user: 1, status: 1 });

export default mongoose.model('Entitlement', entitlementSchema);
