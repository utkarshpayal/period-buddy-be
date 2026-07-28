import mongoose from 'mongoose';

const healthIssueSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    category: { type: String, required: true, trim: true },
    icon: { type: String, default: 'alert-circle-outline' },
    color: { type: String, default: '#ef4444' },
    summary: { type: String, required: true, trim: true },
    guide: { type: String, required: true, trim: true },
    imageUrl: { type: String },

    // New production fields
    symptoms: [{ type: String, trim: true }],
    causes: [{ type: String, trim: true }],
    treatment: { type: String, trim: true },
    prevention: { type: String, trim: true },
    whenToSeeDoctor: { type: String, trim: true },

    isActive: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

healthIssueSchema.index({ isActive: 1, order: 1 });

export default mongoose.model('HealthIssue', healthIssueSchema);
