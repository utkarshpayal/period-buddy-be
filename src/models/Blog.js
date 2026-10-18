import mongoose from 'mongoose';
import { blogCategoryEnum, blogStatusEnum } from '../enums/enums.js';
import { readingMinutes } from '../utils/blogReadTime.js';
import { medicalReviewFields } from '../utils/medicalReview.js';

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

    // Minutes to read, computed from `content` on every write (see the hooks
    // below and utils/blogReadTime.js). Not hand-edited.
    readTimeMinutes: { type: Number, default: 0 },

    // Real dwell-time analytics, reported by the client when a reader closes
    // the article (see trackBlogView). Analytics only (`averageReadMinutes`
    // in the app API); it gates viewCount so a reader who bounced in under a
    // second doesn't count as a "view".
    totalReadSeconds: { type: Number, default: 0 },
    readSessionCount: { type: Number, default: 0 },
    // Sessions that reached the end of the article (utils/blogReadStats.js).
    completedReadCount: { type: Number, default: 0 },

    // SEO fields
    seoTitle: { type: String, trim: true },
    seoDescription: { type: String, trim: true },
    canonicalUrl: { type: String, trim: true },

    // Medical review stamp + workflow (utils/medicalReview.js)
    ...medicalReviewFields(),

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
// slug is already indexed by its `unique: true` (a second { slug: 1 } spec
// only made Mongoose warn about a duplicate index).
// Published lists: GET /api/blogs?category= and the public API (latest/popular).
blogSchema.index({ status: 1, isPublished: 1, category: 1, publishedAt: -1 });
blogSchema.index({ status: 1, isPublished: 1, viewCount: -1, publishedAt: -1 });
blogSchema.index({ tags: 1 });
blogSchema.index({ authorId: 1 });

/*
 * `isPublished` (what the Admin Workspace's contentController toggles) and
 * `status` (what the public blogController reads) used to drift apart, so a
 * blog "unpublished" in the workspace stayed readable by slug and in
 * bookmarks, and workspace-created blogs 404'd by slug. Keep them in lockstep
 * whichever one a writer sets; `isPublished` wins if both are set and
 * disagree (on create and on update alike).
 *
 * The same hooks also:
 * - give a post its `publishedAt` the first time it goes live, when the
 *   writer didn't pass one (publishing by `status` alone used to leave it
 *   null, which sank the post to the bottom of every "latest" list);
 * - compute `readTimeMinutes` from `content` (utils/blogReadTime.js), so it
 *   is always the article's real length, never a stale or missing estimate.
 */
export const statusForPublished = (isPublished, currentStatus) => {
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
  } else if (publishedChanged) {
    this.status = statusForPublished(this.isPublished, this.status);
  } else if (statusChanged) {
    this.isPublished = this.status === blogStatusEnum.PUBLISHED;
  }
  if (this.isPublished && !this.publishedAt) this.publishedAt = new Date();
  if (this.isNew || this.isModified('content') || !(this.readTimeMinutes > 0)) {
    this.readTimeMinutes = readingMinutes(this.content, this.readTimeMinutes);
  }
  next();
});

const UPDATE_OPERATORS = ['$set', '$setOnInsert'];

/**
 * Rewrites an update (plain fields, `$set` or `$setOnInsert`) so it keeps
 * `status`/`isPublished` in step and derives `readTimeMinutes` from
 * `content`. Exported for unit tests. Returns true when the update makes the
 * post live without choosing a `publishedAt`, so the caller can fill it.
 */
export const normalizeBlogUpdate = (update) => {
  if (!update || Array.isArray(update)) return false;
  const where = (field) => {
    if (Object.prototype.hasOwnProperty.call(update, field)) return update;
    return UPDATE_OPERATORS.map((op) => update[op]).find(
      (target) => target && Object.prototype.hasOwnProperty.call(target, field),
    );
  };
  const publishedIn = where('isPublished');
  const statusIn = where('status');
  let live;
  if (publishedIn) {
    // Cast like Mongoose will ('false' is false), not like JS truthiness.
    live = [true, 'true', 1, '1'].includes(publishedIn.isPublished);
    const status = statusIn ? statusIn.status : undefined;
    const synced = statusForPublished(live, status);
    if (status !== synced) {
      if (statusIn) statusIn.status = synced;
      else publishedIn.status = synced;
    }
  } else if (statusIn) {
    live = statusIn.status === blogStatusEnum.PUBLISHED;
    statusIn.isPublished = live;
  }

  const contentIn = where('content');
  const readTimeIn = where('readTimeMinutes');
  if (contentIn) {
    const minutes = readingMinutes(contentIn.content);
    if (readTimeIn && readTimeIn !== contentIn) delete readTimeIn.readTimeMinutes;
    contentIn.readTimeMinutes = minutes;
  } else if (readTimeIn) {
    // Reading time follows the content; a hand-typed estimate is ignored.
    delete readTimeIn.readTimeMinutes;
  }

  const publishedAtIn = where('publishedAt');
  if (publishedAtIn && live && !publishedAtIn.publishedAt) {
    // `publishedAt: null` alongside a publish would leave it unset.
    delete publishedAtIn.publishedAt;
  }
  return Boolean(live && !where('publishedAt'));
};

blogSchema.pre(['findOneAndUpdate', 'updateOne'], async function () {
  const update = this.getUpdate();
  const needsPublishedAt = normalizeBlogUpdate(update);
  if (!needsPublishedAt) return;
  // Keep the original date when an already-dated post is re-published.
  const current = await this.model.findOne(this.getQuery()).select('publishedAt').lean();
  if (!current?.publishedAt) update.$set = { ...update.$set, publishedAt: new Date() };
});

// A bulk write can't look at each post's own date, so it doesn't fill
// `publishedAt`; the read side falls back to `createdAt`.
blogSchema.pre('updateMany', function (next) {
  normalizeBlogUpdate(this.getUpdate());
  next();
});

/**
 * Recomputes `readTimeMinutes` from `content` for the matching posts and
 * stores any that were missing or stale. Raw collection writes, so neither
 * the update hooks nor `updatedAt` are touched. Resolves to a Map of
 * id -> minutes for every matched post.
 */
blogSchema.statics.backfillReadTimes = async function (filter = {}) {
  const docs = await this.find(filter).select('content readTimeMinutes').lean();
  const minutesById = new Map();
  const ops = [];
  for (const doc of docs) {
    const minutes = readingMinutes(doc.content, doc.readTimeMinutes);
    minutesById.set(String(doc._id), minutes);
    if (minutes !== doc.readTimeMinutes) {
      ops.push({
        updateOne: { filter: { _id: doc._id }, update: { $set: { readTimeMinutes: minutes } } },
      });
    }
  }
  if (ops.length) await this.collection.bulkWrite(ops, { ordered: false });
  return minutesById;
};

blogSchema.virtual('viewsCount').get(function () {
  return this.viewCount;
});

blogSchema.virtual('likesCount').get(function () {
  return this.likeCount;
});

export default mongoose.model('Blog', blogSchema);
