import Blog from '../models/Blog.js';
import BlogReader from '../models/BlogReader.js';
import Reel from '../models/Reel.js';
import User from '../models/User.js';
import slugify from 'slugify';
import { blogStatusEnum } from '../enums/enums.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
  normalizeStringArray,
  pickDefined,
} from '../utils/apiHelpers.js';
import { SUPPORTED_LANGUAGES, translateText, TRANSLATE_MAX_CHARS } from '../utils/sarvamClient.js';
import { readingMinutes } from '../utils/blogReadTime.js';
import { parseReadReport, readIncrement, readStats } from '../utils/blogReadStats.js';

export { readingMinutes };

/** Reading time for a post: from its content when we have it, else the
 * stored value (computed from content on every write, see models/Blog.js). */
export const readTimeFor = (obj) =>
  typeof obj.content === 'string'
    ? readingMinutes(obj.content, obj.readTimeMinutes)
    : Math.max(1, Math.round(Number(obj.readTimeMinutes) || 0) || 1);

/**
 * App shape of a blog. `readTimeMinutes` is the article's length (~200 wpm).
 * It used to be replaced by the average time readers kept the article open,
 * which a single tab left open for an hour (or a few quick bounces) skewed
 * into "60 min read"/"0 min read"; that average is now its own field.
 */
const withReadTime = (blog) => {
  const obj = blog.toObject ? blog.toObject() : blog;
  obj.readTimeMinutes = readTimeFor(obj);
  Object.assign(obj, readStats(obj));
  return obj;
};

/**
 * Posts saved before reading time was computed server-side have none (or a
 * hand-typed 0). Fill those in, store them, and return the docs as plain
 * objects with `readTimeMinutes` set — needed for lists, which don't load
 * `content`.
 */
export const ensureReadTimes = async (blogs) => {
  const objects = blogs.map((blog) => (blog.toObject ? blog.toObject() : blog));
  const missing = objects.filter(
    (obj) => typeof obj.content !== 'string' && !(obj.readTimeMinutes > 0),
  );
  if (missing.length) {
    try {
      const minutes = await Blog.backfillReadTimes({ _id: { $in: missing.map((o) => o._id) } });
      for (const obj of missing) {
        const value = minutes.get(String(obj._id));
        if (value) obj.readTimeMinutes = value;
      }
    } catch (error) {
      // A failed backfill must never fail the read; readTimeFor falls back to 1.
      logger.warn('blog_read_time_backfill_failed', {
        action: 'blog_read_time_backfill_failed',
        error: error.message,
      });
    }
  }
  return objects;
};

const BLOG_STATUS_ALIASES = {
  publish: blogStatusEnum.PUBLISHED,
  published: blogStatusEnum.PUBLISHED,
  live: blogStatusEnum.PUBLISHED,
  active: blogStatusEnum.PUBLISHED,
  draft: blogStatusEnum.DRAFT,
  unpublish: blogStatusEnum.DRAFT,
  unpublished: blogStatusEnum.DRAFT,
  inactive: blogStatusEnum.DRAFT,
  archive: blogStatusEnum.ARCHIVED,
  archived: blogStatusEnum.ARCHIVED,
};

/** Status from a request: a `blogStatusEnum` value, undefined when absent,
 * or null when it isn't one we understand. */
export const normalizeBlogStatus = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  return BLOG_STATUS_ALIASES[String(value).trim().toLowerCase()] ?? null;
};

const chunkTextForTranslation = (text, maxChars) => {
  const paragraphs = text.split(/\n{2,}/);
  const chunks = [];
  let current = '';

  const pushCurrent = () => {
    if (current) chunks.push(current);
    current = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      pushCurrent();
      for (let i = 0; i < paragraph.length; i += maxChars) {
        chunks.push(paragraph.slice(i, i + maxChars));
      }
      continue;
    }

    const candidate = current ? `${current}\n\n${paragraph}` : paragraph;
    if (candidate.length > maxChars) {
      pushCurrent();
      current = paragraph;
    } else {
      current = candidate;
    }
  }
  pushCurrent();

  return chunks;
};

/** GET /api/blogs?category=&tag=&page=1 — Paginated published blogs */
export const getBlogs = async (req, res, next) => {
  try {
    const { category, tag, search } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 10, maxLimit: 50 });

    const filter = publishedFilter();
    if (category) filter.category = category;
    if (tag) filter.tags = tag;
    if (search)
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: 'i' } },
        { excerpt: { $regex: escapeRegex(search), $options: 'i' } },
      ];

    const [blogs, total] = await Promise.all([
      Blog.find(filter).select('-content').sort({ publishedAt: -1 }).skip(skip).limit(limit),
      Blog.countDocuments(filter),
    ]);

    logger.info('blogs_fetched', {
      action: 'blogs_fetched',
      count: blogs.length,
      page,
      category,
      tag,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Blogs fetched', {
      blogs: (await ensureReadTimes(blogs)).map(withReadTime),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/blogs/:slug — Get single blog post. viewCount/read-time now come
 * from real reader sessions (see trackBlogView) instead of incrementing on
 * every fetch, which counted accidental opens and bot/crawler hits the same
 * as a genuine read. */
export const getBlogBySlug = async (req, res, next) => {
  try {
    const blog = await Blog.findOne({ ...publishedFilter(), slug: req.params.slug });

    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Blog post', withReadTime(blog));
  } catch (error) {
    next(error);
  }
};

/** POST /api/blogs/:id/track-view — Reports *active* reading time (on
 * screen, app in front, reader not idle; see utils/blogReadStats.js). A
 * session may arrive in parts (`continued: true` adds time without counting
 * another read); `completed: true` marks that the reader reached the end.
 * Bounces under MIN_READ_SECONDS don't count as views. */
export const trackBlogView = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid blog id');
    }

    const report = parseReadReport(req.body);
    if (report.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, report.error);

    const existing = await Blog.findById(req.params.id).select('readTimeMinutes').lean();
    if (!existing) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    const readerKey = { blogId: existing._id, userId: req.userId };
    const reader = await BlogReader.findOne(readerKey).select('completed').lean();
    const inc = readIncrement(report, existing.readTimeMinutes, reader);
    if (!inc)
      return sendResponse(res, HTTP_STATUS.OK, 'Session too short to count', { counted: false });

    // The unique (blog, user) index decides who is new: if two first reports
    // race, only one upsert inserts, and only that one adds the view.
    let blogInc = inc.blog;
    const readerSet = { lastReadAt: new Date(), ...(inc.completed ? { completed: true } : {}) };
    try {
      await BlogReader.updateOne(
        readerKey,
        { $inc: inc.reader, $set: readerSet },
        { upsert: true },
      );
    } catch (error) {
      if (error?.code !== 11000) throw error;
      const { viewCount: _counted, ...rest } = blogInc;
      blogInc = rest;
      await BlogReader.updateOne(readerKey, { $inc: inc.reader, $set: readerSet });
    }

    const blog = await Blog.findByIdAndUpdate(req.params.id, { $inc: blogInc }, { new: true })
      .select('viewCount readTimeMinutes totalReadSeconds readSessionCount completedReadCount')
      .lean();
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'View recorded', {
      counted: true,
      viewCount: blog.viewCount,
      readTimeMinutes: readTimeFor(blog),
      ...readStats(blog),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/blogs/:slug/translate — Translate a blog's title + content into
 * another language via Sarvam. Content is chunked to stay under the
 * translation model's per-request character limit. */
export const translateBlog = async (req, res, next) => {
  try {
    const { language } = req.body;
    const supported = SUPPORTED_LANGUAGES.some((l) => l.code === language);
    if (!supported) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A supported language is required');
    }

    const blog = await Blog.findOne({ ...publishedFilter(), slug: req.params.slug });
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    if (language === 'en-IN') {
      return sendResponse(res, HTTP_STATUS.OK, 'Blog translated', {
        title: blog.title,
        content: blog.content,
        language,
      });
    }

    const contentChunks = chunkTextForTranslation(blog.content, TRANSLATE_MAX_CHARS);
    const [translatedTitle, ...translatedChunks] = await Promise.all([
      translateText({ input: blog.title, targetLanguageCode: language }),
      ...contentChunks.map((chunk) =>
        translateText({ input: chunk, targetLanguageCode: language }),
      ),
    ]);

    logger.info('blog_translated', {
      action: 'blog_translated',
      blogId: blog._id,
      language,
      chunks: contentChunks.length,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Blog translated', {
      title: translatedTitle.translatedText,
      content: translatedChunks.map((chunk) => chunk.translatedText).join('\n\n'),
      language,
    });
  } catch (error) {
    logger.error('blog_translate_error', { action: 'blog_translate_error', error: error.message });
    next(error);
  }
};

/** POST /api/blogs/:id/bookmark — Toggle bookmark on a blog post */
export const toggleBookmark = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid blog id');
    }

    const blog = await Blog.findOne({ ...publishedFilter(), _id: req.params.id });
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    const user = await User.findById(req.userId).select('savedBlogs');
    const alreadySaved = user.savedBlogs.some((id) => String(id) === String(blog._id));

    if (alreadySaved) {
      user.savedBlogs = user.savedBlogs.filter((id) => String(id) !== String(blog._id));
    } else {
      user.savedBlogs.push(blog._id);
    }
    await user.save();

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      alreadySaved ? 'Blog unbookmarked' : 'Blog bookmarked',
      {
        bookmarked: !alreadySaved,
      },
    );
  } catch (error) {
    next(error);
  }
};

/** GET /api/blogs/bookmarks — All of the current user's bookmarked blogs */
export const getBookmarkedBlogs = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('savedBlogs');
    const blogs = await Blog.find({ ...publishedFilter(), _id: { $in: user.savedBlogs } })
      .select('-content')
      .sort({ publishedAt: -1 });

    return sendResponse(res, HTTP_STATUS.OK, 'Bookmarked blogs fetched', {
      blogs: (await ensureReadTimes(blogs)).map(withReadTime),
    });
  } catch (error) {
    next(error);
  }
};

// The combined feed only ever considered each source's newest 100 items.
const FEED_SOURCE_CAP = 100;
// Only what the feed items, ensureReadTimes and readStats read. Hydrated
// (not lean) so selected paths keep their schema defaults (tags: [], ...).
const FEED_BLOG_FIELDS =
  'title author coverImageUrl excerpt slug category tags readTimeMinutes totalReadSeconds ' +
  'readSessionCount completedReadCount viewCount likeCount publishedAt createdAt';
const FEED_REEL_FIELDS =
  'title creatorName duration thumbnailUrl verified pollQuestion category publishedAt createdAt';

/**
 * The first `wanted` items of `Model.find(filter).sort({ publishedAt: -1 })
 * .limit(FEED_SOURCE_CAP)`, plus how many items that capped query returns.
 * Items with no publishedAt sort last there but are merged by createdAt, so
 * any of them inside the cap are always loaded (there are few or none).
 */
const loadFeedSource = async (Model, filter, fields, wanted) => {
  const datedFilter = { ...filter, publishedAt: { $ne: null } };
  const [dated, datedTotal] = await Promise.all([
    Model.find(datedFilter).select(fields).sort({ publishedAt: -1 }).limit(wanted),
    Model.countDocuments(datedFilter, { limit: FEED_SOURCE_CAP }),
  ]);
  const undated =
    datedTotal < FEED_SOURCE_CAP
      ? await Model.find({ ...filter, publishedAt: null })
          .select(fields)
          .limit(FEED_SOURCE_CAP - datedTotal)
      : [];
  return { items: [...dated, ...undated], total: datedTotal + undated.length };
};

/** GET /api/blogs/feed?type=all|blog|reel — Combined insight feed */
export const getContentFeed = async (req, res, next) => {
  try {
    const { type = 'all', search, category, tag } = req.query;
    const { page, limit } = getPagination(req.query, { limit: 10, maxLimit: 50 });

    // Same published test as every other read; `isPublished` alone let a
    // post whose status said draft/archived show in the feed and then 404
    // when opened by slug.
    const blogFilter = publishedFilter();
    const reelFilter = { isActive: true };

    if (category) blogFilter.category = category;
    if (tag) blogFilter.tags = tag;

    if (search) {
      blogFilter.$or = [
        { title: { $regex: escapeRegex(search), $options: 'i' } },
        { excerpt: { $regex: escapeRegex(search), $options: 'i' } },
      ];
      reelFilter.$or = [
        { title: { $regex: escapeRegex(search), $options: 'i' } },
        { creatorName: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    // Each source still counts its newest FEED_SOURCE_CAP items (that's what
    // `total` and the last page have always been), but only the first
    // page * limit of each can reach this page, so only those are loaded.
    const wanted = Math.min(page * limit, FEED_SOURCE_CAP);
    const [blogSource, reelSource] = await Promise.all([
      type === 'reel'
        ? { items: [], total: 0 }
        : loadFeedSource(Blog, blogFilter, FEED_BLOG_FIELDS, wanted),
      type === 'blog'
        ? { items: [], total: 0 }
        : loadFeedSource(Reel, reelFilter, FEED_REEL_FIELDS, wanted),
    ]);
    const blogs = await ensureReadTimes(blogSource.items);
    const reels = reelSource.items;

    const items = [
      ...blogs.map(withReadTime).map((blog) => ({
        id: String(blog._id),
        sourceId: String(blog._id),
        title: blog.title,
        author: blog.author,
        type: 'blog',
        time: `${blog.readTimeMinutes} min read`,
        imageUrl: blog.coverImageUrl,
        verified: true,
        summary: blog.excerpt,
        slug: blog.slug,
        category: blog.category,
        tags: blog.tags,
        readTimeMinutes: blog.readTimeMinutes,
        averageReadSeconds: blog.averageReadSeconds,
        viewCount: blog.viewCount,
        likeCount: blog.likeCount,
        publishedAt: blog.publishedAt || blog.createdAt,
      })),
      ...reels.map((reel) => ({
        id: String(reel._id),
        sourceId: String(reel._id),
        title: reel.title,
        author: reel.creatorName,
        type: 'reel',
        time: reel.duration || '0',
        imageUrl: reel.thumbnailUrl,
        verified: reel.verified,
        summary: reel.pollQuestion || reel.category,
        publishedAt: reel.publishedAt || reel.createdAt,
      })),
    ].sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));

    const start = (page - 1) * limit;
    const pagedItems = items.slice(start, start + limit);

    return sendResponse(res, HTTP_STATUS.OK, 'Content feed fetched', {
      items: pagedItems,
      pagination: buildPagination({ page, limit, total: blogSource.total + reelSource.total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/blogs — Admin: Create a blog post */
export const createBlog = async (req, res, next) => {
  try {
    const { title, content, excerpt, coverImageUrl, category, author, isPublished, status } =
      req.body;

    if (!title || !content) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'title and content are required');
    }
    const normalizedStatus = normalizeBlogStatus(status);
    if (normalizedStatus === null) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid status');

    const slug = slugify(title, { lower: true, strict: true });
    const blog = await Blog.create({
      title,
      slug,
      content,
      excerpt,
      coverImageUrl,
      category,
      tags: normalizeStringArray(req.body.tags),
      author,
      // The model's save hook reconciles these two and fills publishedAt.
      isPublished:
        isPublished === undefined ? undefined : isPublished === true || isPublished === 'true',
      status: normalizedStatus || blogStatusEnum.DRAFT,
    });

    logger.info('blog_created', { action: 'blog_created', id: blog._id, title, slug });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Blog created', blog);
  } catch (error) {
    if (error.code === 11000) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'A blog with that title already exists');
    }
    next(error);
  }
};

/** PATCH /api/blogs/:id/like — Like a blog post */
export const likeBlog = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid blog id');
    }

    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      { $inc: { likeCount: 1 } },
      { new: true },
    );
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Blog liked', { likesCount: blog.likeCount });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/blogs/:id — Admin: Update blog */
export const updateBlog = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid blog id');
    }

    const updates = pickDefined(req.body, [
      'title',
      'content',
      'excerpt',
      'coverImageUrl',
      'category',
      'tags',
      'author',
      'isPublished',
      'status',
    ]);

    if (updates.status !== undefined) {
      updates.status = normalizeBlogStatus(updates.status);
      if (updates.status === null) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid status');
      if (updates.status === undefined) delete updates.status;
    }

    const current = await Blog.findById(req.params.id).select('title isPublished');
    if (!current) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');
    // Only a real title change on a post that isn't live moves its URL; a
    // published post keeps its slug so links and bookmarks keep working.
    if (updates.title && updates.title.trim() !== current.title && !current.isPublished) {
      updates.slug = slugify(updates.title, { lower: true, strict: true });
    }
    if (updates.tags !== undefined) updates.tags = normalizeStringArray(updates.tags);
    // publishedAt and readTimeMinutes are filled by the Blog model's hooks.

    const blog = await Blog.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Blog updated', blog);
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/blogs/:id — Admin: Unpublish blog */
export const deleteBlog = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid blog id');
    }

    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      { isPublished: false, status: blogStatusEnum.DRAFT, publishedAt: null },
      { new: true, runValidators: true },
    );
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Blog unpublished');
  } catch (error) {
    next(error);
  }
};

/* ──────────────────────────────────────────────────────────
   Public (unauthenticated) read API — used by the marketing site's /blog.
   Read-only, published posts only, and an explicit field allowlist so
   internal analytics (totalReadSeconds, readSessionCount) and authorId
   never leave the API.
────────────────────────────────────────────────────────── */

// Lists use the stored reading time (kept in step with the content by the
// Blog model), so they no longer load every article body.
const PUBLIC_LIST_FIELDS =
  'title slug excerpt coverImageUrl category tags author readTimeMinutes ' +
  'viewCount publishedAt createdAt updatedAt medicallyReviewed reviewedBy reviewedAt';
const PUBLIC_DETAIL_FIELDS = `${PUBLIC_LIST_FIELDS} content seoTitle seoDescription canonicalUrl`;
const PUBLIC_SORTS = {
  latest: { publishedAt: -1 },
  popular: { viewCount: -1, publishedAt: -1 },
};
// Lets the CDN/browser reuse public blog responses briefly; posts change
// rarely and a few minutes of staleness after a CMS edit is fine.
const PUBLIC_CACHE_HEADER = 'public, max-age=300, stale-while-revalidate=600';

const publishedFilter = () => ({ status: blogStatusEnum.PUBLISHED, isPublished: true });

/** Shapes a blog for the public API: only the fields a public reader
 * should see. */
export const toPublicBlog = (blog, { includeContent = false } = {}) => {
  const obj = blog.toObject ? blog.toObject() : blog;
  return {
    id: String(obj._id),
    title: obj.title,
    slug: obj.slug,
    excerpt: obj.excerpt || '',
    coverImageUrl: obj.coverImageUrl || null,
    category: obj.category,
    tags: obj.tags || [],
    author: obj.author,
    readTimeMinutes: readTimeFor(obj),
    publishedAt: obj.publishedAt || obj.createdAt,
    updatedAt: obj.updatedAt,
    // Medical review stamp (published posts only reach this function).
    medicallyReviewed: Boolean(obj.medicallyReviewed),
    reviewedBy: obj.medicallyReviewed ? obj.reviewedBy || null : null,
    reviewedAt: obj.medicallyReviewed ? obj.reviewedAt || null : null,
    ...(includeContent
      ? {
          content: obj.content,
          seoTitle: obj.seoTitle || null,
          seoDescription: obj.seoDescription || null,
          canonicalUrl: obj.canonicalUrl || null,
        }
      : {}),
  };
};

/** GET /api/blogs/public?topic=&tag=&search=&sort=latest|popular&page=&limit= */
export const getPublicBlogs = async (req, res, next) => {
  try {
    const { topic, tag, search } = req.query;
    const sort = Object.hasOwn(PUBLIC_SORTS, req.query.sort)
      ? PUBLIC_SORTS[req.query.sort]
      : PUBLIC_SORTS.latest;
    const { page, limit, skip } = getPagination(req.query, { limit: 12, maxLimit: 24 });

    const filter = publishedFilter();
    if (typeof topic === 'string' && topic) filter.category = topic;
    if (typeof tag === 'string' && tag) filter.tags = tag;
    if (typeof search === 'string' && search.trim()) {
      const pattern = { $regex: escapeRegex(search.trim().slice(0, 100)), $options: 'i' };
      filter.$or = [{ title: pattern }, { excerpt: pattern }, { tags: pattern }];
    }

    const [blogs, total] = await Promise.all([
      Blog.find(filter).select(PUBLIC_LIST_FIELDS).sort(sort).skip(skip).limit(limit),
      Blog.countDocuments(filter),
    ]);

    res.set('Cache-Control', PUBLIC_CACHE_HEADER);
    return sendResponse(res, HTTP_STATUS.OK, 'Blogs fetched', {
      blogs: (await ensureReadTimes(blogs)).map((blog) => toPublicBlog(blog)),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/blogs/public/topics — Topics (categories) with post counts, plus
 * the most-used tags, for the blog's topic navigation. */
export const getPublicBlogTopics = async (req, res, next) => {
  try {
    const [topics, tags] = await Promise.all([
      Blog.aggregate([
        { $match: publishedFilter() },
        { $sort: { publishedAt: -1 } },
        {
          $group: {
            _id: '$category',
            count: { $sum: 1 },
            coverImageUrl: { $first: '$coverImageUrl' },
          },
        },
        { $sort: { count: -1 } },
      ]),
      Blog.aggregate([
        { $match: publishedFilter() },
        { $unwind: '$tags' },
        { $group: { _id: '$tags', count: { $sum: 1 } } },
        { $sort: { count: -1, _id: 1 } },
        { $limit: 20 },
      ]),
    ]);

    res.set('Cache-Control', PUBLIC_CACHE_HEADER);
    return sendResponse(res, HTTP_STATUS.OK, 'Blog topics fetched', {
      topics: topics
        .filter((t) => t._id)
        .map((t) => ({ id: t._id, count: t.count, coverImageUrl: t.coverImageUrl || null })),
      tags: tags.map((t) => ({ name: t._id, count: t.count })),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/blogs/public/:slug — One published post with its full content,
 * plus up to 3 related posts (same topic or a shared tag). */
export const getPublicBlogBySlug = async (req, res, next) => {
  try {
    const blog = await Blog.findOne({ ...publishedFilter(), slug: req.params.slug }).select(
      PUBLIC_DETAIL_FIELDS,
    );
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    const relatedOr = [{ category: blog.category }];
    if (blog.tags?.length) relatedOr.push({ tags: { $in: blog.tags } });
    let related = await Blog.find({ ...publishedFilter(), _id: { $ne: blog._id }, $or: relatedOr })
      .select(PUBLIC_LIST_FIELDS)
      .sort({ publishedAt: -1 })
      .limit(3);
    // Top up with the latest posts so the "keep reading" row is never empty.
    if (related.length < 3) {
      const exclude = [blog._id, ...related.map((r) => r._id)];
      const latest = await Blog.find({ ...publishedFilter(), _id: { $nin: exclude } })
        .select(PUBLIC_LIST_FIELDS)
        .sort({ publishedAt: -1 })
        .limit(3 - related.length);
      related = [...related, ...latest];
    }

    res.set('Cache-Control', PUBLIC_CACHE_HEADER);
    return sendResponse(res, HTTP_STATUS.OK, 'Blog post', {
      blog: toPublicBlog(blog, { includeContent: true }),
      related: (await ensureReadTimes(related)).map((r) => toPublicBlog(r)),
    });
  } catch (error) {
    next(error);
  }
};

const SITE_URL = (process.env.PUBLIC_SITE_URL || 'https://thenura.care').replace(/\/$/, '');
const xmlEscape = (value) =>
  String(value).replace(
    /[<>&'"]/g,
    (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' })[c],
  );

/** GET /api/blogs/public/sitemap.xml — Every published post and topic page,
 * so search engines find articles the static site sitemap can't list. The
 * marketing site proxies this at /sitemap-blog.xml. */
export const getPublicBlogSitemap = async (req, res, next) => {
  try {
    const [blogs, topics] = await Promise.all([
      Blog.find(publishedFilter()).select('slug updatedAt publishedAt').sort({ publishedAt: -1 }),
      Blog.distinct('category', publishedFilter()),
    ]);

    const urls = [
      `<url><loc>${SITE_URL}/blog</loc></url>`,
      ...topics
        .filter(Boolean)
        .map(
          (t) => `<url><loc>${SITE_URL}/blog/topic/${xmlEscape(encodeURIComponent(t))}</loc></url>`,
        ),
      ...blogs.map((b) => {
        const lastmod = (b.updatedAt || b.publishedAt)?.toISOString?.().slice(0, 10);
        return (
          `<url><loc>${SITE_URL}/blog/${xmlEscape(encodeURIComponent(b.slug))}</loc>` +
          `${lastmod ? `<lastmod>${lastmod}</lastmod>` : ''}</url>`
        );
      }),
    ];

    res.set('Cache-Control', 'public, max-age=3600');
    return res
      .type('application/xml')
      .send(
        '<?xml version="1.0" encoding="UTF-8"?>\n' +
          '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
          `${urls.join('\n')}\n</urlset>\n`,
      );
  } catch (error) {
    next(error);
  }
};
