import mongoose from 'mongoose';
import { CYCLE_PHASES } from '../utils/cycle.js';
import { CYCLE_SYNC_CATEGORIES } from '../constants/cycleSync.js';

/**
 * CycleSyncTip — one phase-matched tip on the app's Phase Era screen
 * (move / fuel / self-care / vibe), edited from the App CMS. While the
 * collection is empty the app is served constants/cycleSync.js's defaults.
 */
const cycleSyncTipSchema = new mongoose.Schema(
  {
    phase: { type: String, enum: CYCLE_PHASES, required: true },
    category: { type: String, enum: CYCLE_SYNC_CATEGORIES, required: true },
    emoji: { type: String, default: '', maxlength: 16 },
    title: { type: String, required: true, trim: true, maxlength: 60 },
    body: { type: String, default: '', trim: true, maxlength: 200 },
    active: { type: Boolean, default: true },
    order: { type: Number, default: 0 },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

cycleSyncTipSchema.index({ phase: 1, category: 1, order: 1 });

export default mongoose.model('CycleSyncTip', cycleSyncTipSchema);
