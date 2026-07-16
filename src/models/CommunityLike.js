import mongoose from 'mongoose';

/** CommunityLike — normalised like records for community posts. */
const communityLikeSchema = new mongoose.Schema(
  {
    postId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'CommunityPost',
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true }
);

communityLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export default mongoose.model('CommunityLike', communityLikeSchema);
