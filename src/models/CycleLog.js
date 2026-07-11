import mongoose from 'mongoose';

const cycleLogSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    date: { type: Date, required: true },
    dateKey: { type: String, required: true }, // 'YYYY-MM-DD'
    flow: { type: String, enum: ['none', 'light', 'medium', 'heavy', 'spotting'], default: 'none' },
    mood: {
      type: String,
      enum: ['happy', 'calm', 'emotional', 'tired', 'sad', 'anxious', 'irritable', 'neutral', 'energetic'],
    },
    energy: { type: String, enum: ['low', 'medium', 'steady', 'high'] },
    symptoms: [{ type: String, trim: true }],
    note: { type: String, trim: true, maxlength: 1000, default: '' },
    cycleDay: { type: Number },
    phase: { type: String, enum: ['period', 'follicular', 'ovulation', 'luteal'] },
    tokensEarned: { type: Number, default: 0 },
  },
  { timestamps: true }
);

// Compound unique index: one log per user per day
cycleLogSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

export default mongoose.model('CycleLog', cycleLogSchema);
