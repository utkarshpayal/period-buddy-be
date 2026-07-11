import mongoose from 'mongoose';

const cycleSettingsSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    lastPeriodStartDate: { type: Date, required: true },
    cycleLength: { type: Number, default: 28, min: 20, max: 45 },
    periodLength: { type: Number, default: 5, min: 1, max: 10 },
    remindersEnabled: { type: Boolean, default: true },
    reminderDaysBefore: { type: Number, default: 2, min: 0, max: 14 },
  },
  { timestamps: true }
);

export default mongoose.model('CycleSettings', cycleSettingsSchema);
