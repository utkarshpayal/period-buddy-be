import mongoose from 'mongoose';

const wellbeingResourceSchema = new mongoose.Schema(
  {
    type: { type: String, enum: ['sexual_wellbeing', 'hygiene'], required: true },
    title: { type: String, required: true, trim: true },
    icon: { type: String, default: 'heart-outline' },
    color: { type: String, default: '#d946a6' },
    summary: { type: String, required: true },
    extendedGuide: [{ type: String }],
    items: { type: Number, default: 0 },
    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

wellbeingResourceSchema.index({ type: 1, isActive: 1, order: 1 });

export default mongoose.model('WellbeingResource', wellbeingResourceSchema);
