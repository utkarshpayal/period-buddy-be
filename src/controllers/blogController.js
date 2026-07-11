import Blog from '../models/Blog.js';
import Reel from '../models/Reel.js';
import slugify from 'slugify';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { buildPagination, escapeRegex, getPagination, isValidObjectId, normalizeStringArray, pickDefined } from '../utils/apiHelpers.js';

/** GET /api/blogs?category=&tag=&page=1 — Paginated published blogs */
export const getBlogs = async (req, res, next) => {
  try {
    const { category, tag, search } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 10, maxLimit: 50 });

    const filter = { isPublished: true };
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
      blogs,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/blogs/:slug — Get single blog post + increment views */
export const getBlogBySlug = async (req, res, next) => {
  try {
    const blog = await Blog.findOneAndUpdate(
      { slug: req.params.slug, isPublished: true },
      { $inc: { views: 1 } },
      { new: true }
    );

    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Blog post', blog);
  } catch (error) {
    next(error);
  }
};

/** GET /api/blogs/feed?type=all|blog|reel — Combined insight feed */
export const getContentFeed = async (req, res, next) => {
  try {
    const { type = 'all', search } = req.query;
    const { page, limit } = getPagination(req.query, { limit: 10, maxLimit: 50 });

    const blogFilter = { isPublished: true };
    const reelFilter = { isActive: true };

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
      ...blogs.map((blog) => ({
        id: String(blog._id),
        sourceId: String(blog._id),
        title: blog.title,
        author: blog.author,
        type: 'blog',
        time: `${blog.readTimeMinutes || 5} min read`,
        imageUrl: blog.coverImageUrl,
        verified: true,
        summary: blog.excerpt,
        slug: blog.slug,
        publishedAt: blog.publishedAt || blog.createdAt,
      })),
      ...reels.map((reel) => ({
        id: String(reel._id),
        sourceId: String(reel._id),
        title: reel.title,
        author: reel.creatorName,
        type: 'reel',
        time: reel.duration || 'Video',
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
    const { title, content, excerpt, coverImageUrl, category, author, readTimeMinutes, isPublished } = req.body;

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
      readTimeMinutes,
      isPublished: !!isPublished,
      publishedAt: isPublished ? new Date() : null,
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

    const blog = await Blog.findByIdAndUpdate(req.params.id, { $inc: { likes: 1 } }, { new: true });
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Blog liked', { likes: blog.likes });
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
      'readTimeMinutes',
      'isPublished',
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

    const blog = await Blog.findByIdAndUpdate(req.params.id, { isPublished: false }, { new: true });
    if (!blog) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Blog not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Blog unpublished');
  } catch (error) {
    next(error);
  }
};
