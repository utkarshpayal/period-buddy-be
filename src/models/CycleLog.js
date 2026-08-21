import mongoose from 'mongoose';

// Shared by `mood` and `moods` below so the two enums can't drift apart.
// `emotional`/`tired`/`neutral` are kept for backward-compat with older logs
// even though the app's log modal no longer offers them as chips — their
// closest replacements are `moodSwings`/`lowEnergy`/`apathetic`. The rest
// (frisky, moodSwings, depressed, guilty, obsessive, lowEnergy, apathetic,
// confused, selfCritical) were added alongside period-buddy's expanded
// day-log modal (see period-buddy/components/DayDetailsModal.tsx).
const MOOD_VALUES = [
  'happy',
  'calm',
  'emotional',
  'tired',
  'sad',
  'anxious',
  'irritable',
  'neutral',
  'energetic',
  'frisky',
  'moodSwings',
  'depressed',
  'guilty',
  'obsessive',
  'lowEnergy',
  'apathetic',
  'confused',
  'selfCritical',
];

const cycleLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    date: { type: Date, required: true },
    dateKey: { type: String, required: true }, // 'YYYY-MM-DD'
    flow: {
      type: String,
      enum: ['none', 'light', 'medium', 'heavy', 'spotting'],
      default: 'none',
    },
    mood: {
      type: String,
      enum: MOOD_VALUES,
    },
    // Multi-select counterpart to `mood` — a day can carry several moods. The
    // scalar `mood` stays populated with the primary (first) value for
    // backward-compat; `moods` holds the full set.
    moods: [
      {
        type: String,
        enum: MOOD_VALUES,
      },
    ],
    energy: { type: String, enum: ['low', 'medium', 'steady', 'high'] },
    symptoms: [{ type: String, trim: true }],
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    // Explicitly user-tagged, separate from `note` — a day's note can be about
    // anything (cramps, mood, medication), so it can't be used to infer this.
    isIntimate: { type: Boolean, default: false },
    cycleDay: { type: Number },
    phase: { type: String, enum: ['period', 'follicular', 'ovulation', 'luteal'] },

    // Reward points (rewardPoints replaces tokensEarned)
    rewardPoints: { type: Number, default: 0 },

    // Health tracking fields
    sleepHours: { type: Number, min: 0, max: 24 },
    waterIntake: { type: Number, min: 0 }, // ml
    weight: { type: Number, min: 0 }, // kg
    temperature: { type: Number }, // °C BBT
    stressLevel: { type: Number, min: 1, max: 10 },
    medication: [{ type: String, trim: true }],
    digestion: {
      type: String,
      enum: ['normal', 'constipated', 'diarrhea', 'bloated'],
    },
    // Multi-select counterpart to `digestion` (see `moods` above).
    digestions: [
      {
        type: String,
        enum: ['normal', 'constipated', 'diarrhea', 'bloated'],
      },
    ],
    skin: {
      type: String,
      enum: ['clear', 'oily', 'dry', 'acne'],
    },
    // Multi-select counterpart to `skin` (see `moods` above).
    skins: [
      {
        type: String,
        enum: ['clear', 'oily', 'dry', 'acne'],
      },
    ],
    discharge: {
      type: String,
      enum: ['none', 'sticky', 'creamy', 'watery', 'egg-white'],
    },
    exercise: [{ type: String, trim: true }],
  },
  { timestamps: true },
);

// Compound unique index: one log per user per day
cycleLogSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

export default mongoose.model('CycleLog', cycleLogSchema);
