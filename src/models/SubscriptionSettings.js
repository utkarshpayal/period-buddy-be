import mongoose from 'mongoose';

// Singleton document — always exactly one row, read/written through
// utils/subscriptionAccess.js#getSettings(). Never construct this model
// directly elsewhere.
const subscriptionSettingsSchema = new mongoose.Schema(
  {
    // Master switch. Off by default so shipping this feature never changes
    // behavior for existing users until an admin opts in explicitly.
    subscriptionEnabled: { type: Boolean, default: false },
    currency: { type: String, default: 'INR', trim: true, uppercase: true },
    // When false, the app/API only offers whole plans — no standalone
    // per-feature purchases.
    allowFeatureWisePurchase: { type: Boolean, default: true },
    // Days of continued access after `expiresAt` before a feature is
    // actually locked (soft-landing for renewal reminders). 0 = hard cutoff.
    graceDays: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

export default mongoose.model('SubscriptionSettings', subscriptionSettingsSchema);
