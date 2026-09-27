import mongoose from 'mongoose';

/**
 * LaunchInterest — one "Notify me" tap on a Coming soon feature or link tile
 * in the app (see utils/launch.js). `itemKey` is the feature key or
 * `link:<tileId>`. Signed-out people are kept by device; when the same
 * device joins again signed in, the entry gains the user.
 */
const launchInterestSchema = new mongoose.Schema(
  {
    itemKey: { type: String, required: true },
    user: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    deviceId: { type: String },
    platform: { type: String, enum: ['android', 'ios', 'web', null], default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One entry per person, and per device while signed out.
launchInterestSchema.index(
  { itemKey: 1, user: 1 },
  { unique: true, partialFilterExpression: { user: { $type: 'objectId' } } },
);
launchInterestSchema.index(
  { itemKey: 1, deviceId: 1 },
  { unique: true, partialFilterExpression: { deviceId: { $type: 'string' } } },
);

export default mongoose.model('LaunchInterest', launchInterestSchema);
