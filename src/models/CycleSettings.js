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
    // which is a push-notification reminder, not an outbound call. Days are
    // re-derived from the live prediction every tick, so it recurs each
    // cycle with no "next occurrence" bookkeeping. Each attempt, retries
    // included, is a CheckinCall document.
    checkinCallEnabled: { type: Boolean, default: false },
    // 'period_daily' = one answered call on each day of the period
    // (periodLength days). 'once' = one call per cycle, on period start +
    // checkinCallDayOffset. Existing schedules predate the field, so the
    // default stays 'once'.
    checkinCallMode: { type: String, enum: ['once', 'period_daily'], default: 'once' },
    // 'once' mode only. Days relative to the period start: 0 = on period
    // day, negative = N days before, positive = N days after.
    checkinCallDayOffset: { type: Number, default: 0, min: -10, max: 10 },
    // Local time of day, 'HH:mm' (24h) — paired with
    // checkinCallTimezoneOffsetMinutes to resolve to the user's actual local
    // moment (same tzOffset convention as cycleController.js's upsertCycleLog).
    checkinCallTime: { type: String, match: /^([01]\d|2[0-3]):[0-5]\d$/ },
    checkinCallTimezoneOffsetMinutes: { type: Number },
    // Legacy once-a-day guard from before CheckinCall existed. No longer
    // read or written.
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

// Scheduler candidate queries (checkinCallScheduler.js, dailyNotificationScheduler.js).
cycleSettingsSchema.index({ checkinCallEnabled: 1 });
cycleSettingsSchema.index({ remindersEnabled: 1 });
cycleSettingsSchema.index({ ovulationReminder: 1 });
cycleSettingsSchema.index({ fertilityReminder: 1 });

export default mongoose.model('CycleSettings', cycleSettingsSchema);
