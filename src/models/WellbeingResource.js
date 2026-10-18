import mongoose from 'mongoose';
import { invalidateMemoOnWrite } from '../utils/memoCache.js';
import { medicalReviewFields } from '../utils/medicalReview.js';

const wellbeingResourceSchema = new mongoose.Schema(
  {
    type: {
      type: String,
      enum: ['sexual_wellbeing', 'hygiene'],
      required: true,
    },
    title: { type: String, required: true, trim: true },
    icon: { type: String, default: 'heart-outline' },
    color: { type: String, default: '#d946a6' },
    summary: { type: String, required: true },
    extendedGuide: [{ type: String }],
    items: { type: Number, default: 0 },

    // Admin's initial estimate, shown until real reader sessions accumulate
    // (see totalReadSeconds/readSessionCount below).
    estimatedReadTime: { type: Number, default: 0 }, // minutes

    // Real dwell-time analytics, reported by the client when a reader closes
    // the resource (see trackResourceView) — replaces the static
    // estimatedReadTime once there's enough real data.
    totalReadSeconds: { type: Number, default: 0 },
    readSessionCount: { type: Number, default: 0 },

    videoUrl: { type: String, trim: true },
    audioUrl: { type: String, trim: true },

    order: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
    // Medical review stamp + workflow (utils/medicalReview.js)
    ...medicalReviewFields(),
  },
  { timestamps: true },
);

wellbeingResourceSchema.index({ type: 1, isActive: 1, order: 1 });
// GET /api/wellbeing without ?type=.
wellbeingResourceSchema.index({ isActive: 1, order: 1 });

// Any write drops the cached app-facing list (utils/memoCache.js).
wellbeingResourceSchema.plugin(invalidateMemoOnWrite, { prefix: 'wellbeing:' });

export default mongoose.model('WellbeingResource', wellbeingResourceSchema);
