import mongoose from 'mongoose';

/**
 * FeatureUsageDevice — which app installs (the random X-Device-Id, never a
 * user) used an item on a day, so the CMS can count unique devices. Kept
 * 100 days, which covers the longest range the CMS offers (90 days).
 */
const featureUsageDeviceSchema = new mongoose.Schema({
  itemKey: { type: String, required: true },
  day: { type: String, required: true },
  deviceId: { type: String, required: true },
  createdAt: { type: Date, default: Date.now, expires: 60 * 60 * 24 * 100 },
});

featureUsageDeviceSchema.index({ itemKey: 1, day: 1, deviceId: 1 }, { unique: true });
featureUsageDeviceSchema.index({ day: 1 });

export default mongoose.model('FeatureUsageDevice', featureUsageDeviceSchema);
