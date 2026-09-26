import mongoose from 'mongoose';

export const BROADCAST_STATUSES = ['queued', 'running', 'completed', 'failed', 'cancelled'];
export const BROADCAST_AUDIENCES = ['all', 'user', 'partner', 'doctor', 'selected'];
// Upper bound for a hand-picked recipient list; bigger sends should target an
// audience instead.
export const MAX_SELECTED_RECIPIENTS = 5000;

/**
 * PushBroadcast — one admin-triggered push notification sent to many users.
 *
 * The document doubles as the job's durable progress record: the worker
 * (utils/pushBroadcastWorker.js) walks users in _id order and persists
 * `cursor` after every batch, so a crash/restart/deploy mid-send resumes from
 * the last completed batch instead of re-sending to everyone or silently
 * stopping. `leaseUntil` keeps two server instances from working the same
 * broadcast at once.
 */
const pushBroadcastSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    // Optional deep-link payload forwarded as FCM data (string values only).
    data: { type: mongoose.Schema.Types.Mixed, default: undefined },
    audience: { type: String, enum: BROADCAST_AUDIENCES, default: 'all' },
    // Only for audience 'selected': the hand-picked recipients.
    userIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
    // A few recipient labels (name/email) so history can show who a
    // 'selected' send went to without loading every user.
    recipientPreview: { type: [String], default: undefined },
    // Also write an in-app Notification row per user so it shows in the
    // app's notification list (even for users with push disabled).
    saveToInbox: { type: Boolean, default: true },

    status: { type: String, enum: BROADCAST_STATUSES, default: 'queued', index: true },
    cancelRequested: { type: Boolean, default: false },

    // Snapshot at creation time; the live audience can drift while sending.
    totalUsers: { type: Number, default: 0 },
    totalWithToken: { type: Number, default: 0 },

    processedUsers: { type: Number, default: 0 },
    sentCount: { type: Number, default: 0 },
    failedCount: { type: Number, default: 0 },
    invalidTokenCount: { type: Number, default: 0 },
    inboxCount: { type: Number, default: 0 },
    batchesCompleted: { type: Number, default: 0 },

    // Last user _id fully processed — resume point.
    cursor: { type: mongoose.Schema.Types.ObjectId, default: null },
    leaseUntil: { type: Date, default: null },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },

    // Set when this send was made by a PushSchedule occurrence.
    scheduleId: { type: mongoose.Schema.Types.ObjectId, ref: 'PushSchedule', default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    startedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

pushBroadcastSchema.index({ createdAt: -1 });

export default mongoose.model('PushBroadcast', pushBroadcastSchema);
