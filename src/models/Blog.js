import mongoose from 'mongoose';

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    excerpt: { type: String, trim: true, maxlength: 300 },
    coverImageUrl: { type: String },
    category: { type: String, trim: true, default: 'General' },
    tags: [{ type: String, trim: true }],
    author: { type: String, trim: true, default: 'Period Buddy Team' },
    readTimeMinutes: { type: Number, default: 5 },
    isPublished: { type: Boolean, default: false },
    publishedAt: { type: Date },
    views: { type: Number, default: 0 },
    likes: { type: Number, default: 0 },
  },
  { timestamps: true }
);

blogSchema.index({ isPublished: 1, publishedAt: -1 });
blogSchema.index({ slug: 1 });
blogSchema.index({ tags: 1 });

export default mongoose.model('Blog', blogSchema);
