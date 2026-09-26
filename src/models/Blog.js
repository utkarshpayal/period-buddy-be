import mongoose from 'mongoose';
import { blogCategoryEnum, blogStatusEnum } from '../enums/enums.js';

const blogSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true },
    content: { type: String, required: true },
    excerpt: { type: String, trim: true, maxlength: 1000 },
    coverImageUrl: { type: String },
    category: {
      type: String,
      trim: true,
      enum: Object.values(blogCategoryEnum),
      default: blogCategoryEnum.GENERAL,
    },
    tags: [{ type: String, trim: true }],

    // authorId references User — author (string) kept for backward compat
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    author: { type: String, trim: true, default: 'Period Buddy Team' },

    // Admin's initial estimate, shown until real reader sessions accumulate
    // (see totalReadSeconds/readSessionCount below).
    readTimeMinutes: { type: Number, default: 0 },

    // Real dwell-time analytics, reported by the client when a reader closes
    // the article (see trackBlogView) — replaces the static readTimeMinutes
    // estimate once there's enough real data, and gates viewCount so a
    // reader who bounced in under a second doesn't count as a "view".
    totalReadSeconds: { type: Number, default: 0 },
    readSessionCount: { type: Number, default: 0 },

    // SEO fields
    seoTitle: { type: String, trim: true },
    seoDescription: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true },

    // Publication
    isPublished: { type: Boolean, default: false },
    status: {
      type: String,
      enum: Object.values(blogStatusEnum),
      default: blogStatusEnum.DRAFT,
    },
    publishedAt: { type: Date },

    // Counters — viewCount/likeCount are the production names
    viewCount: { type: Number, default: 0 },
    likeCount: { type: Number, default: 0 },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

blogSchema.index({ status: 1, publishedAt: -1 });
blogSchema.index({ slug: 1 });
blogSchema.index({ tags: 1 });
blogSchema.index({ authorId: 1 });

/*
 * `isPublished` (what the Admin Workspace's contentController toggles) and
 * `status` (what the public blogController reads) used to drift apart, so a
 * blog "unpublished" in the workspace stayed readable by slug and in
 * bookmarks, and workspace-created blogs 404'd by slug. Keep them in lockstep
 * whichever one a writer sets; `isPublished` wins if both disagree on create.
 */
const statusForPublished = (isPublished, currentStatus) => {
  if (isPublished) return blogStatusEnum.PUBLISHED;
  return currentStatus === blogStatusEnum.ARCHIVED ? blogStatusEnum.ARCHIVED : blogStatusEnum.DRAFT;
};

blogSchema.pre('save', function (next) {
  const publishedChanged = this.isNew || this.isModified('isPublished');
  const statusChanged = this.isModified('status');
  if (this.isNew) {
    const published = Boolean(this.isPublished) || this.status === blogStatusEnum.PUBLISHED;
    this.isPublished = published;
    this.status = statusForPublished(published, this.status);
  } else if (publishedChanged && !statusChanged) {
    this.status = statusForPublished(this.isPublished, this.status);
  } else if (statusChanged && !publishedChanged) {
    this.isPublished = this.status === blogStatusEnum.PUBLISHED;
  }
  next();
});

blogSchema.pre(['findOneAndUpdate', 'updateOne', 'updateMany'], function (next) {
  const update = this.getUpdate();
  if (!update || Array.isArray(update)) return next();
  // Fields can sit at the top level or under $set (timestamps adds a $set
  // for updatedAt even when the caller wrote plain fields).
  const has = (field) =>
    Object.prototype.hasOwnProperty.call(update, field) ||
    Object.prototype.hasOwnProperty.call(update.$set || {}, field);
  const read = (field) => (field in update ? update[field] : update.$set?.[field]);
  if (has('isPublished') && !has('status')) {
    update.$set = {
      ...update.$set,
      status: read('isPublished') ? blogStatusEnum.PUBLISHED : blogStatusEnum.DRAFT,
    };
  } else if (has('status') && !has('isPublished')) {
    update.$set = { ...update.$set, isPublished: read('status') === blogStatusEnum.PUBLISHED };
  }
  next();
});

blogSchema.virtual('viewsCount').get(function () {
  return this.viewCount;
});

blogSchema.virtual('likesCount').get(function () {
  return this.likeCount;
});

export default mongoose.model('Blog', blogSchema);
