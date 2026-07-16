import mongoose from 'mongoose';

/** Notification — in-app notification records. */
const notificationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    type: {
      type: String,
      enum: [
        'period_reminder', 'ovulation_reminder', 'habit_reminder', 'buddy_message',
        'partner_message', 'consultation_update', 'reward_earned', 'streak_bonus',
        'system', 'community_reply',
      ],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    body: { type: String, trim: true },
    data: { type: mongoose.Schema.Types.Mixed }, // arbitrary payload
    isRead: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    scheduledFor: { type: Date, default: null },
    sentAt: { type: Date, default: null },
  },
  { timestamps: true }
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });

export default mongoose.model('Notification', notificationSchema);
