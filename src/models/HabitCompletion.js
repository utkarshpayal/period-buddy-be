import mongoose from 'mongoose';

/** HabitCompletion — one record per habit-completion event. */
const habitCompletionSchema = new mongoose.Schema(
  {
    habitId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Habit',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    dateKey: { type: String, required: true }, // 'YYYY-MM-DD'
    rewardPoints: { type: Number, default: 0 },
    note: { type: String, trim: true, maxlength: 300 },
  },
  { timestamps: true }
);

habitCompletionSchema.index({ habitId: 1, dateKey: 1 }, { unique: true });
habitCompletionSchema.index({ userId: 1, dateKey: 1 });

export default mongoose.model('HabitCompletion', habitCompletionSchema);
