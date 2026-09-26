import mongoose from 'mongoose';
import { CYCLE_PHASES } from '../utils/cycle.js';

/**
 * CircleVibe — a status post in a BestieCircle: an emoji, a short line, and
 * the poster's phase only if they chose to share it on this post. Vibes are
 * ephemeral (BeReal-style): the TTL index drops them after 7 days.
 */
export const VIBE_TTL_SECONDS = 7 * 24 * 60 * 60;

const reactionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    emoji: { type: String, required: true },
  },
  { _id: false },
);

const circleVibeSchema = new mongoose.Schema(
  {
    circleId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BestieCircle',
      required: true,
      index: true,
    },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    emoji: { type: String, required: true, maxlength: 16 },
    text: { type: String, default: '', trim: true, maxlength: 80 },
    phase: { type: String, enum: [...CYCLE_PHASES, null], default: null },
    askForSupport: { type: Boolean, default: false },
    reactions: { type: [reactionSchema], default: [] },
  },
  { timestamps: true },
);

circleVibeSchema.index({ circleId: 1, createdAt: -1 });
circleVibeSchema.index({ createdAt: 1 }, { expireAfterSeconds: VIBE_TTL_SECONDS });

export default mongoose.model('CircleVibe', circleVibeSchema);
