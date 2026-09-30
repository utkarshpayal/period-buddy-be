import mongoose from 'mongoose';
import User from './User.js';
import { sendPushNotification } from '../utils/fcm.js';
import logger from '../utils/logger.js';
import { pushFor } from '../utils/privacy.js';

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
        'period_reminder',
        'ovulation_reminder',
        'habit_reminder',
        'buddy_message',
        'partner_message',
        'consultation_update',
        'reward_earned',
        'streak_bonus',
        'system',
        'community_reply',
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
  { timestamps: true },
);

notificationSchema.index({ userId: 1, isRead: 1, createdAt: -1 });
// Paginated newest-first listing (GET /api/partner/notifications).
notificationSchema.index({ userId: 1, createdAt: -1 });

notificationSchema.post('save', async function (doc) {
  try {
    const user = await User.findById(doc.userId).select(
      'notificationToken notificationsEnabled isActive deletedAt privacySettings',
    );
    // notificationsEnabled is the app's Profile → Notifications toggle. The
    // in-app row is still saved; only the device push is skipped. A
    // suspended/deleted account's device never gets a push either.
    if (
      user &&
      user.isActive &&
      !user.deletedAt &&
      user.notificationToken &&
      user.notificationsEnabled !== false
    ) {
      // "Hide notification details" (on unless the person turned it off):
      // a locked phone shows neutral text, the details stay in the app's
      // notification list. Tapping still opens the right screen (data).
      await sendPushNotification(
        user.notificationToken,
        pushFor(user, {
          title: doc.title,
          body: doc.body,
          data: { notificationId: String(doc._id), type: doc.type, ...(doc.data || {}) },
        }),
      );
    }
  } catch (error) {
    logger.error('notification_push_send_failed', {
      action: 'notification_push_send_failed',
      notificationId: String(doc._id),
      userId: String(doc.userId),
      error: error.message,
    });
  }
});

export default mongoose.model('Notification', notificationSchema);
