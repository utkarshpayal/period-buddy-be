import mongoose from 'mongoose';
import { invalidateMemoOnWrite } from '../utils/memoCache.js';

// Catalog of gate-able app capabilities. Admins flip `isPremium`/`price` from
// the Content Studio (period-buddy-content) — this collection is the single
// source of truth both `subscriptionMiddleware.requireFeatureAccess()` (API
// gating) and the mobile app's paywall (pricing display) read from.
const subscriptionFeatureSchema = new mongoose.Schema(
  {
    // Stable identifier referenced from route wiring, e.g. 'ai_assistant'.
    // Never change an existing key once routes/plans reference it — add a
    // new feature instead.
    key: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [/^[a-z][a-z0-9_]*$/, 'key must be lowercase snake_case'],
    },
    name: { type: String, required: true, trim: true },
    description: { type: String, trim: true },
    // Free-text grouping label for the admin/app UI, e.g. "AI & Insights".
    category: { type: String, trim: true, default: 'General' },
    // lucide-react(-native) icon name, optional — falls back to a default
    // lock/star icon client-side when unset.
    icon: { type: String, trim: true },

    // The actual free/paid toggle. Everything is free while this is false,
    // regardless of price below.
    isPremium: { type: Boolean, default: false },
    price: { type: Number, default: 0, min: 0 },
    billingCycle: {
      type: String,
      enum: ['monthly', 'yearly', 'one_time'],
      default: 'monthly',
    },

    // Whether the feature exists at all in pricing/paywall UI. Distinct from
    // isPremium: an inactive feature is hidden everywhere and never gates.
    isActive: { type: Boolean, default: true },
    sortOrder: { type: Number, default: 0 },
  },
  { timestamps: true },
);

subscriptionFeatureSchema.index({ isActive: 1, sortOrder: 1 });

// Any write drops the cached app-facing list (utils/memoCache.js).
subscriptionFeatureSchema.plugin(invalidateMemoOnWrite, { prefix: 'subscriptions:' });

export default mongoose.model('SubscriptionFeature', subscriptionFeatureSchema);
