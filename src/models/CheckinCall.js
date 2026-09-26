import mongoose from 'mongoose';

/**
 * CheckinCall — one outbound "Buddy" check-in call attempt (Sarvam Instant
 * Outbound). Written when the call is placed, completed by the call's
 * webhook. The scheduler reads a user's calls for the day to decide whether
 * another attempt is due (see utils/checkinCall.js#planScheduledAttempt), and
 * "call now" reads them for its rate limit.
 */
const checkinCallSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    // 'manual' = the app's "call me now"; 'scheduled' = the day's first
    // automatic attempt; 'retry' = a follow-up after no answer or a
    // callback request.
    source: { type: String, enum: ['manual', 'scheduled', 'retry'], required: true },
    // The user's local date the call belongs to (YYYY-MM-DD) and the
    // period-start dateKey of the cycle it counts against.
    dateKey: { type: String, required: true },
    cycleKey: { type: String },
    // Only set for automatic attempts (1, 2, 3 for the day). Unique per user
    // and day so two overlapping scheduler ticks can't both place attempt N.
    attemptNumber: { type: Number },
    status: {
      type: String,
      enum: ['dialing', 'requested', 'connected', 'no_answer', 'busy', 'failed'],
      default: 'dialing',
    },
    // What the call amounted to, derived from status + the agent's
    // disposition (see classifyCallOutcome).
    outcome: {
      type: String,
      enum: [
        'completed',
        'declined',
        'callback',
        'no_answer',
        'opted_out',
        'wrong_person',
        'dropped',
        'failed',
      ],
    },
    attemptId: { type: String },
    disposition: { type: String },
    logStatus: { type: String },
    durationSeconds: { type: Number },
    summary: { type: String, trim: true, maxlength: 1000 },
    loggedFields: [{ type: String }],
    failureReason: { type: String, trim: true, maxlength: 500 },
    retryAt: { type: Date },
    endedAt: { type: Date },
  },
  { timestamps: true },
);

checkinCallSchema.index({ userId: 1, dateKey: 1 });
checkinCallSchema.index({ userId: 1, createdAt: -1 });
checkinCallSchema.index({ userId: 1, cycleKey: 1, outcome: 1 });
checkinCallSchema.index(
  { userId: 1, dateKey: 1, attemptNumber: 1 },
  { unique: true, partialFilterExpression: { attemptNumber: { $exists: true } } },
);

export default mongoose.model('CheckinCall', checkinCallSchema);
