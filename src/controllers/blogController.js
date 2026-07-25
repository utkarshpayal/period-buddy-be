import Blog from '../models/Blog.js';
import Reel from '../models/Reel.js';
import User from '../models/User.js';
import slugify from 'slugify';
import { blogStatusEnum } from '../enums/enums.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { buildPagination, escapeRegex, getPagination, isValidObjectId, normalizeStringArray, pickDefined } from '../utils/apiHelpers.js';
import { SUPPORTED_LANGUAGES, translateText, TRANSLATE_MAX_CHARS } from '../utils/sarvamClient.js';

// A session shorter than this is treated as a bounce (accidental open, back
// button, etc.) rather than a genuine read — it doesn't count toward
// viewCount or the real read-time average.
const MIN_VIEW_SECONDS = 5;
// Sanity cap — protects the average from a client that reports a bogus
// duration (e.g. a tab left open overnight).
const MAX_VIEW_SECONDS = 60 * 60;

/** Effective read time: once enough real reader sessions have been tracked,
 * that data replaces the admin's static estimate. */
const withEffectiveReadTime = (blog) => {
  const obj = blog.toObject ? blog.toObject() : blog;
  if (obj.readSessionCount > 0) {
    obj.readTimeMinutes = Math.max(1, Math.round(obj.totalReadSeconds / obj.readSessionCount / 60));
  }
  return obj;
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

    const filter = { status: blogStatusEnum.PUBLISHED, isPublished: true };
    if (category) filter.category = category;
    if (tag) filter.tags = tag;
    if (search) filter.$or = [
      { title: { $regex: escapeRegex(search), $options: 'i' } },
      { excerpt: { $regex: escapeRegex(search), $options: 'i' } },
    ];

    const [blogs, total] = await Promise.all([
      Blog.find(filter).select('-content').sort({ publishedAt: -1 }).skip(skip).limit(limit),
      Blog.countDocuments(filter),
    ]);

    logger.info('blogs_fetched', { action: 'blogs_fetched', count: blogs.length, page, category, tag });

    return sendResponse(res, HTTP_STATUS.OK, 'Blogs fetched', {
      blogs: blogs.map(withEffectiveReadTime),
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
    const blog = await Blog.findOne({ slug: req.params.slug, status: blogStatusEnum.PUBLISHED });

    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Blog post', withEffectiveReadTime(blog));
  } catch (error) {
    next(error);
  }
};

/** POST /api/blogs/:id/track-view — Reports how long the reader actually
 * had the article open. Only sessions clearing MIN_VIEW_SECONDS count
 * toward viewCount and the real read-time average, so a bounce (opened by
 * mistake, closed in under a second) doesn't inflate either. */
export const trackBlogView = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid blog id');
    }

    const durationSeconds = Number(req.body.durationSeconds);
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid durationSeconds is required');
    }

    if (durationSeconds < MIN_VIEW_SECONDS) {
      return sendResponse(res, HTTP_STATUS.OK, 'Session too short to count', { counted: false });
    }

    const clampedSeconds = Math.min(durationSeconds, MAX_VIEW_SECONDS);

    const blog = await Blog.findByIdAndUpdate(
      req.params.id,
      { $inc: { viewCount: 1, totalReadSeconds: clampedSeconds, readSessionCount: 1 } },
      { new: true }
    );
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'View recorded', {
      counted: true,
      viewCount: blog.viewCount,
      readTimeMinutes: withEffectiveReadTime(blog).readTimeMinutes,
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

    const blog = await Blog.findOne({ slug: req.params.slug, status: blogStatusEnum.PUBLISHED });
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
      ...contentChunks.map((chunk) => translateText({ input: chunk, targetLanguageCode: language })),
    ]);

    logger.info('blog_translated', { action: 'blog_translated', blogId: blog._id, language, chunks: contentChunks.length });

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

    const blog = await Blog.findOne({ _id: req.params.id, status: blogStatusEnum.PUBLISHED });
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    const user = await User.findById(req.userId).select('savedBlogs');
    const alreadySaved = user.savedBlogs.some((id) => String(id) === String(blog._id));

    if (alreadySaved) {
      user.savedBlogs = user.savedBlogs.filter((id) => String(id) !== String(blog._id));
    } else {
      user.savedBlogs.push(blog._id);
    }
    await user.save();

    return sendResponse(res, HTTP_STATUS.OK, alreadySaved ? 'Blog unbookmarked' : 'Blog bookmarked', {
      bookmarked: !alreadySaved,
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/blogs/bookmarks — All of the current user's bookmarked blogs */
export const getBookmarkedBlogs = async (req, res, next) => {
  try {
    const user = await User.findById(req.userId).select('savedBlogs');
    const blogs = await Blog.find({
      _id: { $in: user.savedBlogs },
      status: blogStatusEnum.PUBLISHED,
    })
      .select('-content')
      .sort({ publishedAt: -1 });

    return sendResponse(res, HTTP_STATUS.OK, 'Bookmarked blogs fetched', {
      blogs: blogs.map(withEffectiveReadTime),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/blogs/feed?type=all|blog|reel — Combined insight feed */
export const getContentFeed = async (req, res, next) => {
  try {
    const { type = 'all', search, category, tag } = req.query;
    const { page, limit } = getPagination(req.query, { limit: 10, maxLimit: 50 });

    const blogFilter = { isPublished: true };
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

    const [blogs, reels] = await Promise.all([
      type === 'reel' ? [] : Blog.find(blogFilter).sort({ publishedAt: -1 }).limit(100),
      type === 'blog' ? [] : Reel.find(reelFilter).sort({ publishedAt: -1 }).limit(100),
    ]);

    const items = [
      ...blogs.map(withEffectiveReadTime).map((blog) => ({
        id: String(blog._id),
        sourceId: String(blog._id),
        title: blog.title,
        author: blog.author,
        type: 'blog',
        time: `${blog.readTimeMinutes || 0} min read`,
        imageUrl: blog.coverImageUrl,
        verified: true,
        summary: blog.excerpt,
        slug: blog.slug,
        category: blog.category,
        tags: blog.tags,
        readTimeMinutes: blog.readTimeMinutes,
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
      pagination: buildPagination({ page, limit, total: items.length }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/blogs — Admin: Create a blog post */
export const createBlog = async (req, res, next) => {
  try {
    const { title, content, excerpt, coverImageUrl, category, author, isPublished, status } = req.body;

    if (!title || !content) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'title and content are required');
    }

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
      isPublished: !!isPublished,
      publishedAt: isPublished ? new Date() : null,
      status: status || blogStatusEnum.DRAFT,
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

    const blog = await Blog.findByIdAndUpdate(req.params.id, { $inc: { likeCount: 1 } }, { new: true });
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
      'status'
    ]);

    if (updates.title) {
      updates.slug = slugify(updates.title, { lower: true, strict: true });
    }
    if (updates.tags !== undefined) updates.tags = normalizeStringArray(updates.tags);
    if (updates.isPublished === true) updates.publishedAt = new Date();

    const blog = await Blog.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
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

    const blog = await Blog.findByIdAndUpdate(req.params.id, { isPublished: false, status: blogStatusEnum.DRAFT, publishedAt: null }, { new: true, runValidators: true });
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Blog unpublished');
  } catch (error) {
    next(error);
  }
};
