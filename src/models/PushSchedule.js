import mongoose from 'mongoose';
import { BROADCAST_AUDIENCES } from './PushBroadcast.js';
import { REPEAT_KINDS } from '../utils/pushSchedule.js';

export const SCHEDULE_STATUSES = ['active', 'paused', 'completed', 'cancelled'];

/**
 * PushSchedule — an admin push that goes out later, once or on repeat.
 *
 * It holds the message and the timing rule only. Each time it comes due,
 * utils/pushScheduleRunner.js claims it (by advancing `nextRunAt` atomically,
 * so two instances never fire the same occurrence) and creates an ordinary
 * PushBroadcast for that send, which the broadcast worker delivers. History,
 * progress, cancel and retry for a single send therefore work exactly like a
 * send-now broadcast.
 *
 * Timing (utils/pushSchedule.js): `startAt` is the first send and fixes the
 * IST time of day; `repeat` + `interval` (+ `daysOfWeek` for weekly) give the
 * rest; `endAt` / `maxRuns` optionally end the series.
 */
const pushScheduleSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 100 },
    body: { type: String, required: true, trim: true, maxlength: 500 },
    data: { type: mongoose.Schema.Types.Mixed, default: undefined },
    audience: { type: String, enum: BROADCAST_AUDIENCES, default: 'all' },
    userIds: { type: [mongoose.Schema.Types.ObjectId], default: undefined },
    recipientPreview: { type: [String], default: undefined },
    saveToInbox: { type: Boolean, default: true },

    repeat: { type: String, enum: REPEAT_KINDS, default: 'none' },
    startAt: { type: Date, required: true },
    interval: { type: Number, default: 1, min: 1 },
    daysOfWeek: { type: [Number], default: undefined },
    endAt: { type: Date, default: null },
    maxRuns: { type: Number, default: null },

    status: { type: String, enum: SCHEDULE_STATUSES, default: 'active' },
    // Next send; null once the series is over.
    nextRunAt: { type: Date, default: null },
    runCount: { type: Number, default: 0 },
    // Occurrences dropped because the server was down well past them.
    skippedCount: { type: Number, default: 0 },
    lastRunAt: { type: Date, default: null },
    lastBroadcastId: { type: mongoose.Schema.Types.ObjectId, ref: 'PushBroadcast', default: null },
    lastError: { type: String, default: null },

    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

pushScheduleSchema.index({ status: 1, nextRunAt: 1 });
pushScheduleSchema.index({ createdAt: -1 });

export default mongoose.model('PushSchedule', pushScheduleSchema);
