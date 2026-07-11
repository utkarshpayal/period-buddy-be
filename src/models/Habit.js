import mongoose from 'mongoose';

const habitSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 100 },
    icon: { type: String, default: 'calendar-outline' },
    color: { type: String, default: '#d946a6' },
    tokens: { type: Number, default: 30, min: 1, max: 200 },
    streak: { type: Number, default: 0, min: 0 },
    completedDates: [{ type: String }], // 'YYYY-MM-DD' keys
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

habitSchema.index({ userId: 1, isActive: 1 });

export default mongoose.model('Habit', habitSchema);
