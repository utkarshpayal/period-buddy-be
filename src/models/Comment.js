import mongoose from 'mongoose';

/**
 * Comment — standalone collection for post and sub-content comments.
 * Replaces embedded comment sub-documents in CommunityPost.
 */
const commentSchema = new mongoose.Schema(
  {
    targetType: {
      type: String,
      enum: ['community_post', 'reel', 'blog'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    isAnonymous: { type: Boolean, default: false },
    likeCount: { type: Number, default: 0, min: 0 },
    parentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Comment',
      default: null,
    }, // for nested replies
    isActive: { type: Boolean, default: true },
    isOwn: { type: Boolean, default: false }, // virtual set at query time
  },
  { timestamps: true },
);

commentSchema.index({ targetType: 1, targetId: 1, createdAt: -1 });
commentSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model('Comment', commentSchema);
