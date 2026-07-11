import mongoose from 'mongoose';

const commentSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  content: { type: String, required: true, trim: true },
  isAnonymous: { type: Boolean, default: true },
  likes: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
});

const communityPostSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, trim: true, maxlength: 200 },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    category: {
      type: String,
      enum: ['general', 'symptoms', 'advice', 'success_story', 'question', 'rant'],
      default: 'general',
    },
    tags: [{ type: String, trim: true }],
    isAnonymous: { type: Boolean, default: true },
    likes: { type: Number, default: 0 },
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [commentSchema],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

communityPostSchema.index({ isActive: 1, createdAt: -1 });
communityPostSchema.index({ category: 1, createdAt: -1 });

export default mongoose.model('CommunityPost', communityPostSchema);
