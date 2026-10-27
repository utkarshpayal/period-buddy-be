import mongoose from 'mongoose';
import { invalidateMemoOnWrite } from '../utils/memoCache.js';

// An admin-defined bundle of SubscriptionFeature keys sold at one price —
// the alternative to buying features one at a time. `features` intentionally
// stores plain string keys rather than ObjectId refs so a plan keeps working
// even if a feature doc is edited/recreated; subscriptionAccess.js resolves
// keys against the live SubscriptionFeature catalog at read time.
const subscriptionPlanSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, trim: true, lowercase: true },
    description: { type: String, trim: true },
    price: { type: Number, required: true, min: 0 },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly', 'one_time'],
      default: 'monthly',
    },
    features: [{ type: String, trim: true, lowercase: true }],

    // The implicit "Free" plan — informational only (a user never needs an
    // Entitlement to be on it); at most one plan should have this set.
    isDefault: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
    // Optional highlight ribbon in pricing UI, e.g. "Most popular".
    badge: { type: String, trim: true },

    // Plans sold as one product at different cycles share a family (monthly,
    // yearly and founding Premium are all 'premium'). Buying while a plan of
    // the same family is live starts after it ends (utils/pricing.js#accessStart).
    family: { type: String, trim: true, lowercase: true, default: null },

    // Set only on a promotional plan such as the founding-member offer. It
    // can be bought only while `isActive`, before `endsAt`, under
    // `maxRedemptions` and by eligible users (utils/pricing.js). Nothing
    // renews automatically: after the promo year the member is offered
    // `renewalPlanSlug` at its normal price.
    promo: {
      kind: { type: String, trim: true, default: null },
      maxRedemptions: { type: Number, default: null, min: 1 },
      endsAt: { type: Date, default: null },
      // Paid activations so far, incremented once per entitlement.
      redeemedCount: { type: Number, default: 0, min: 0 },
      renewalPlanSlug: { type: String, trim: true, lowercase: true, default: null },
    },
  },
  { timestamps: true },
);

subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

// Any write drops the cached app-facing list (utils/memoCache.js).
subscriptionPlanSchema.plugin(invalidateMemoOnWrite, { prefix: 'subscriptions:' });

export default mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
