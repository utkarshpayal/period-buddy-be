import mongoose from 'mongoose';

/**
 * AppConfigRevision — a snapshot of one AppConfig section taken every time
 * it's published from the CMS, so any earlier state can be restored. Only
 * the newest REVISIONS_KEPT per section are kept.
 */
export const REVISIONS_KEPT = 50;

const appConfigRevisionSchema = new mongoose.Schema(
  {
    section: { type: String, required: true },
    // The section exactly as saved (e.g. { features, customTiles } or { theme }).
    data: { type: mongoose.Schema.Types.Mixed, required: true },
    sectionVersion: { type: Number, required: true },
    note: { type: String, default: null },
    restoredFrom: { type: mongoose.Schema.Types.ObjectId, ref: 'AppConfigRevision', default: null },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: { createdAt: true, updatedAt: false }, minimize: false },
);

appConfigRevisionSchema.index({ section: 1, createdAt: -1 });

export default mongoose.model('AppConfigRevision', appConfigRevisionSchema);
