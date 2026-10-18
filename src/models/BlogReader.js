import mongoose from 'mongoose';

/**
 * One row per (blog, reader): the blog's view count is the number of these
 * rows, so one person reading again doesn't add a view. Holds only counters
 * and dates (no free text). Written by blogController#trackBlogView.
 */
const blogReaderSchema = new mongoose.Schema(
  {
    blogId: { type: mongoose.Schema.Types.ObjectId, ref: 'Blog', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    totalReadSeconds: { type: Number, default: 0 },
    sessionCount: { type: Number, default: 0 },
    completed: { type: Boolean, default: false },
    lastReadAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

blogReaderSchema.index({ blogId: 1, userId: 1 }, { unique: true });
blogReaderSchema.index({ userId: 1 });

export default mongoose.model('BlogReader', blogReaderSchema);
