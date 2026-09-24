import mongoose from 'mongoose';

const cycleSettingsSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    lastPeriodStartDate: { type: Date, required: true },
    cycleLength: { type: Number, default: 28, min: 20, max: 45 },
    periodLength: { type: Number, default: 5, min: 1, max: 10 },
    remindersEnabled: { type: Boolean, default: true },
    reminderDaysBefore: { type: Number, default: 2, min: 0, max: 10 },

    // Additional reminder settings
    ovulationReminder: { type: Boolean, default: false },
    fertilityReminder: { type: Boolean, default: false },

    // Guards for utils/dailyNotificationScheduler.js, mirroring
    // checkinCallLastFiredDateKey below — each keeps its reminder from
    // firing more than once per cycle/day if the daily tick runs more than
    // once around the trigger moment.
    // Keyed by the predicted date itself (not just "fired: true") so it
    // re-arms automatically next cycle without extra bookkeeping — the same
    // trick checkinCallLastFiredDateKey uses.
    lastPeriodReminderCycleKey: { type: String },
    lastOvulationReminderCycleKey: { type: String },
    // The daily "log today" nudge is once-per-calendar-day, not once-per-cycle.
    lastDailyNudgeDateKey: { type: String },

    // Recurring "Buddy" cycle check-in phone call (see
    // utils/checkinCallScheduler.js) — distinct from remindersEnabled above,
    // which is a push-notification reminder, not an outbound call. Fires
    // every cycle on the day computed as (predicted period start date +
    // checkinCallDayOffset), at checkinCallTime local time — recurs
    // naturally each cycle since it's re-derived from the live prediction,
    // no separate "next occurrence" bookkeeping needed.
    checkinCallEnabled: { type: Boolean, default: false },
    // Days relative to the predicted period start: 0 = on period day,
    // negative = N days before, positive = N days after.
    checkinCallDayOffset: { type: Number, default: 0, min: -10, max: 10 },
    // Local time of day, 'HH:mm' (24h) — paired with
    // checkinCallTimezoneOffsetMinutes to resolve to the user's actual local
    // moment (same tzOffset convention as cycleController.js's upsertCycleLog).
    checkinCallTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    checkinCallTimezoneOffsetMinutes: { type: Number },
    // Guards against firing twice in the same local day if the cron tick
    // overlaps a slow call or the server restarts mid-day.
    checkinCallLastFiredDateKey: { type: String },

    // Tracking goals
    pregnancyMode: { type: Boolean, default: false },
    trackingGoal: {
      type: String,
      enum: [
        'track_period',
        'avoid_pregnancy',
        'achieve_pregnancy',
        'manage_symptoms',
        'general_health',
      ],
      default: 'track_period',
    },
    // Multi-select goals — users often track for more than one reason. The
    // scalar `trackingGoal` stays the primary (first) goal for backward-compat;
    // `trackingGoals` holds the full set.
    trackingGoals: {
      type: [
        {
          type: String,
          enum: [
            'track_period',
            'avoid_pregnancy',
            'achieve_pregnancy',
            'manage_symptoms',
            'general_health',
          ],
        },
      ],
      default: ['track_period'],
    },
  },
  { timestamps: true },
);

export default mongoose.model('CycleSettings', cycleSettingsSchema);
