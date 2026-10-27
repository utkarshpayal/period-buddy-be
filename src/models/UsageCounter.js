import mongoose from 'mongoose';

// How many times a user did one counted action (utils/pricing.js#QUOTAS) in
// one period ('d:YYYY-MM-DD' or 'm:YYYY-MM', India time). Read and written
// only through utils/usageQuota.js, which claims a unit with a single atomic
// update so concurrent requests can't both slip under the limit. Holds counts
// only: never message text, file names or anything about the person's health.
const usageCounterSchema = new mongoose.Schema(
  {
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    key: { type: String, required: true, trim: true },
    period: { type: String, required: true, trim: true },
    count: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

usageCounterSchema.index({ user: 1, key: 1, period: 1 }, { unique: true });
// The admin overview sums one period across everyone.
usageCounterSchema.index({ period: 1, key: 1 });

export default mongoose.model('UsageCounter', usageCounterSchema);
