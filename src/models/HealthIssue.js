import mongoose from 'mongoose';
import { invalidateMemoOnWrite } from '../utils/memoCache.js';
import { medicalReviewFields } from '../utils/medicalReview.js';

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
    // Medical review stamp + workflow (utils/medicalReview.js)
    ...medicalReviewFields(),
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

healthIssueSchema.index({ isActive: 1, order: 1 });

// Any write drops the cached app-facing list (utils/memoCache.js).
healthIssueSchema.plugin(invalidateMemoOnWrite, { prefix: 'health-issues:' });

export default mongoose.model('HealthIssue', healthIssueSchema);
