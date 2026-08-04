import mongoose from 'mongoose';

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
      enum: [
        'happy',
        'calm',
        'emotional',
        'tired',
        'sad',
        'anxious',
        'irritable',
        'neutral',
        'energetic',
      ],
    },
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
    skin: {
      type: String,
      enum: ['clear', 'oily', 'dry', 'acne'],
    },
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
