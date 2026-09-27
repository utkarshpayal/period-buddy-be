import mongoose from 'mongoose';

/**
 * LaunchStat — counters per App CMS item (feature key or `link:<tileId>`).
 * `lockedTaps` is bumped by the app's beacon when someone taps a Coming soon
 * tile: the cheapest demand signal there is.
 */
const launchStatSchema = new mongoose.Schema({
  itemKey: { type: String, required: true, unique: true },
  lockedTaps: { type: Number, default: 0 },
});

export default mongoose.model('LaunchStat', launchStatSchema);
