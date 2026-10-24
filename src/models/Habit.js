import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

const habitSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    icon: { type: String, default: 'calendar-outline' },
    color: { type: String, default: '#d946a6' },
    // Why it was suggested ("You logged cramps on 3 days lately"), kept so the
    // card can still say why. From health logs, so encrypted.
    reason: { type: String, trim: true, maxlength: 120 },

    // rewardPoints replaces tokens
    rewardPoints: { type: Number, default: 30, min: 1, max: 200 },

    streak: { type: Number, default: 0, min: 0 },

    // New production fields
    frequency: {
      type: String,
      enum: ['daily', 'weekly', 'custom'],
      default: 'daily',
    },
    target: { type: Number, default: 1, min: 1 }, // times per frequency
    reminderTime: { type: String, trim: true }, // 'HH:MM'

    isActive: { type: Boolean, default: true },

    /** @deprecated use HabitCompletion collection */
    completedDates: [{ type: String }], // 'YYYY-MM-DD' keys
  },
  { timestamps: true },
);

habitSchema.index({ userId: 1, isActive: 1 });

habitSchema.plugin(encryptFields, { fields: ['reason'] });

export default mongoose.model('Habit', habitSchema);
