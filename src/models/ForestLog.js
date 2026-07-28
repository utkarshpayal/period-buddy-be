import mongoose from 'mongoose';

const forestLogSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    dateKey: { type: String, required: true },
    careType: {
      type: String,
      enum: ['water', 'symptom_log', 'habit_completion', 'reflection', 'manual'],
      default: 'manual',
    },
    note: { type: String, trim: true, maxlength: 500 },
    healthDelta: { type: Number, default: 5, min: -20, max: 20 },

    // Reward points (rewardPoints replaces tokensEarned)
    rewardPoints: { type: Number, default: 5, min: 0 },

    // New production fields
    duration: { type: Number, min: 0 }, // minutes
    treeType: { type: String, trim: true },
    completed: { type: Boolean, default: true },
  },
  { timestamps: true },
);

forestLogSchema.index({ userId: 1, dateKey: 1 }, { unique: true });

export default mongoose.model('ForestLog', forestLogSchema);
