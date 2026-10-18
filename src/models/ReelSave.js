import mongoose from 'mongoose';

/**
 * ReelSave: one row per (reel, user) bookmark, same pattern as ReelLike.
 * `GET /api/reels/saved` pages these newest first; `Reel.saveCount` follows
 * the inserts/deletes.
 */
const reelSaveSchema = new mongoose.Schema(
  {
    reelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

reelSaveSchema.index({ reelId: 1, userId: 1 }, { unique: true });
reelSaveSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('ReelSave', reelSaveSchema);
