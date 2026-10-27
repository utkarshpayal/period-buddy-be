import mongoose from 'mongoose';

/**
 * One document (key 'global'): which automatic notification categories
 * (utils/autoNotifications.js) an admin has turned off for everyone. An
 * off category is not sent to anyone and its switch shows as unavailable
 * in the app; each person's own choice is kept for when it comes back on.
 */
const autoNotificationConfigSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, default: 'global' },
    disabled: { type: [String], default: [] },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export default mongoose.model('AutoNotificationConfig', autoNotificationConfigSchema);
