import mongoose from 'mongoose';

/**
 * BestieCircle — a small private friend group (≤ CIRCLE_LIMITS.maxMembers)
 * that shares a status emoji ("vibe"), optionally their cycle phase emoji,
 * and hype. Joined with a 6-character invite code. Cycle details beyond the
 * phase emoji a member opts into on each vibe are never shared.
 */
const memberSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    joinedAt: { type: Date, default: Date.now },
  },
  { _id: false },
);

const bestieCircleSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 30 },
    emoji: { type: String, default: '🫶', maxlength: 16 },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    members: { type: [memberSchema], default: [] },
    inviteCode: { type: String, required: true, unique: true },
  },
  { timestamps: true },
);

bestieCircleSchema.index({ 'members.userId': 1 });

export default mongoose.model('BestieCircle', bestieCircleSchema);
