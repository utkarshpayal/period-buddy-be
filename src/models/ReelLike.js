import mongoose from 'mongoose';

/**
 * ReelLike: one row per (reel, user) like. The unique index makes
 * `POST /api/reels/:id/like` idempotent, and `Reel.likeCount` is only ever
 * moved by the request that actually inserted or deleted a row.
 */
const reelLikeSchema = new mongoose.Schema(
  {
    reelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

reelLikeSchema.index({ reelId: 1, userId: 1 }, { unique: true });
reelLikeSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('ReelLike', reelLikeSchema);
