import mongoose from 'mongoose';
import { APPLICATION_STATUSES } from '../constants/schemeCategories.js';

/**
 * A user's in-app record for a benefit that supports an APPLY flow. This is a
 * self-service tracker — Nura does not submit to any government portal on the
 * user's behalf; it records the details they collected and their own progress.
 */
const schemeApplicationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    schemeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'GovernmentBenefit',
      required: true,
      index: true,
    },
    // Denormalised for cheap list rendering without a populate.
    schemeName: { type: String, trim: true },

    // Free-form answers collected by the in-app form.
    formData: { type: Map, of: mongoose.Schema.Types.Mixed, default: {} },
    // Uploaded / referenced supporting documents.
    documents: [
      {
        name: { type: String, trim: true },
        url: { type: String, trim: true },
      },
    ],

    status: { type: String, enum: APPLICATION_STATUSES, default: 'submitted' },
    notes: { type: String, trim: true },

    // Admin review trail — set when an admin approves/declines an application.
    reviewNote: { type: String, trim: true },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
  },
  { timestamps: true },
);

schemeApplicationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('SchemeApplication', schemeApplicationSchema);
