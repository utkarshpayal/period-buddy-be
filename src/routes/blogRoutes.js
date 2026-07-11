import express from 'express';
import * as blogController from '../controllers/blogController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

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
 * @route   GET /api/blogs/:slug
 * @desc    Get a single blog post by slug + increment view count
 * @access  Private
 */
router.get('/:slug', authenticate, blogController.getBlogBySlug);

/**
 * @route   POST /api/blogs
 * @desc    Admin: Create a blog post
 * @access  Admin
 */
router.post('/', authenticate, authorize('admin'), blogController.createBlog);

/**
 * @route   PUT /api/blogs/:id
 * @desc    Admin: Update a blog post
 * @access  Admin
 */
router.put('/:id', authenticate, authorize('admin'), blogController.updateBlog);

/**
 * @route   DELETE /api/blogs/:id
 * @desc    Admin: Unpublish a blog post
 * @access  Admin
 */
router.delete('/:id', authenticate, authorize('admin'), blogController.deleteBlog);

/**
 * @route   PATCH /api/blogs/:id/like
 * @desc    Like a blog post
 * @access  Private
 */
router.patch('/:id/like', authenticate, blogController.likeBlog);

export default router;
