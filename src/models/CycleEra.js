import mongoose from 'mongoose';
import { invalidateMemoOnWrite } from '../utils/memoCache.js';
import { CYCLE_PHASES } from '../utils/cycle.js';

/**
 * CycleEra — an App CMS override of one phase's era card on the Phase Era
 * screen (name, emoji, tagline, gradient). Unset fields fall back to
 * constants/cycleSync.js PHASE_ERAS; deleting the document restores the
 * default.
 */
const cycleEraSchema = new mongoose.Schema(
  {
    phase: { type: String, enum: CYCLE_PHASES, required: true, unique: true },
    name: { type: String, trim: true, maxlength: 30 },
    emoji: { type: String, maxlength: 16 },
    tagline: { type: String, trim: true, maxlength: 120 },
    aura: { type: [String], default: undefined },
    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Any write drops the cached app-facing list (utils/memoCache.js).
cycleEraSchema.plugin(invalidateMemoOnWrite, { prefix: 'genz:' });

export default mongoose.model('CycleEra', cycleEraSchema);
