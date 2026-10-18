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
  },
  { timestamps: true },
);

subscriptionPlanSchema.index({ isActive: 1, sortOrder: 1 });

// Any write drops the cached app-facing list (utils/memoCache.js).
subscriptionPlanSchema.plugin(invalidateMemoOnWrite, { prefix: 'subscriptions:' });

export default mongoose.model('SubscriptionPlan', subscriptionPlanSchema);
