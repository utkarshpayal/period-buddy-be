import express from 'express';
import * as blogController from '../controllers/blogController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

/**
 * @route   GET /api/blogs
 * @desc    Get paginated published blogs (?category=&tag=&search=&page=&limit=)
 * @access  Private
 */
router.get('/', authenticate, blogController.getBlogs);

/**
 * @route   GET /api/blogs/feed
 * @desc    Get combined insights feed from blogs and reels
 * @access  Private
 */
router.get('/feed', authenticate, blogController.getContentFeed);

/**
 * @route   GET /api/blogs/bookmarks
 * @desc    Get all of the current user's bookmarked blogs
 * @access  Private
 */
router.get('/bookmarks', authenticate, blogController.getBookmarkedBlogs);

/**
 * @route   GET /api/blogs/:slug
 * @desc    Get a single blog post by slug
 * @access  Private
 */
router.get('/:slug', authenticate, blogController.getBlogBySlug);

/**
 * @route   POST /api/blogs/:slug/translate
 * @desc    Translate a blog's title + content into another language
 * @access  Private
 */
router.post('/:slug/translate', authenticate, blogController.translateBlog);

/**
 * @route   POST /api/blogs
 * @desc    Admin: Create a blog post
 * @access  Admin
 */
router.post(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  blogController.createBlog,
);

/**
 * @route   PUT /api/blogs/:id
 * @desc    Admin: Update a blog post
 * @access  Admin
 */
router.put(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  blogController.updateBlog,
);

/**
 * @route   DELETE /api/blogs/:id
 * @desc    Admin: Unpublish a blog post
 * @access  Admin
 */
router.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  blogController.deleteBlog,
);

/**
 * @route   PATCH /api/blogs/:id/like
 * @desc    Like a blog post
 * @access  Private
 */
router.patch('/:id/like', authenticate, blogController.likeBlog);

/**
 * @route   POST /api/blogs/:id/bookmark
 * @desc    Toggle bookmark on a blog post
 * @access  Private
 */
router.post('/:id/bookmark', authenticate, blogController.toggleBookmark);

/**
 * @route   POST /api/blogs/:id/track-view
 * @desc    Report real reading dwell time for a blog post
 * @access  Private
 */
router.post('/:id/track-view', authenticate, blogController.trackBlogView);

export default router;
