import mongoose from 'mongoose';

/**
 * FeatureUsage — daily counters per App CMS item (feature key or
 * `link:<tileId>`), from the app's usage beacon. `opens` counts visits to a
 * feature's screen however it was reached; `taps` counts taps on its tile.
 * `day` is the UTC date, "YYYY-MM-DD".
 */
const featureUsageSchema = new mongoose.Schema({
  itemKey: { type: String, required: true },
  day: { type: String, required: true },
  opens: { type: Number, default: 0 },
  taps: { type: Number, default: 0 },
});

featureUsageSchema.index({ itemKey: 1, day: 1 }, { unique: true });
featureUsageSchema.index({ day: 1 });

export default mongoose.model('FeatureUsage', featureUsageSchema);
