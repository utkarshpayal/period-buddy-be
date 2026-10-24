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

    // GST shown at checkout. With pricesIncludeTax the listed price is what's
    // charged and the GST inside it is shown; without it GST is added on top.
    tax: {
      ratePercent: { type: Number, default: 18, min: 0, max: 100 },
      pricesIncludeTax: { type: Boolean, default: true },
    },

    // Fair-use limits per tier (utils/pricing.js#FAIR_USE_DEFAULTS), counted
    // in UsageCounter. Off by default so deploying this changes nothing.
    fairUse: {
      enabled: { type: Boolean, default: false },
      aiMessagesPerDay: {
        free: { type: Number, default: 20, min: 0 },
        premium: { type: Number, default: 100, min: 0 },
      },
      documentsPerMonth: {
        free: { type: Number, default: 2, min: 0 },
        premium: { type: Number, default: 2, min: 0 },
      },
      maxPagesPerDocument: {
        free: { type: Number, default: 5, min: 0 },
        premium: { type: Number, default: 5, min: 0 },
      },
      doctorReportsPerMonth: {
        free: { type: Number, default: 1, min: 0 },
        premium: { type: Number, default: 1, min: 0 },
      },
    },

    // Estimated cost of one unit of each counted action, in rupees, for the
    // admin usage overview. 0 = not known yet; set from real provider bills.
    unitCostInr: {
      ai_message: { type: Number, default: 0, min: 0 },
      document_upload: { type: Number, default: 0, min: 0 },
      doctor_report: { type: Number, default: 0, min: 0 },
    },
  },
  { timestamps: true },
);

export default mongoose.model('SubscriptionSettings', subscriptionSettingsSchema);
