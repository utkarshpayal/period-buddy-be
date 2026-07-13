import express from 'express';
import * as communityController from '../controllers/communityController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/community
 * @desc    Get paginated community posts (?category=&search=&page=&limit=)
 * @access  Private
 */
router.get('/', authenticate, communityController.getPosts);

/**
 * @route   POST /api/community
 * @desc    Create an anonymous community post
 * @access  Private
 */
router.post('/', authenticate, communityController.createPost);

/**
 * @route   GET /api/community/:id
 * @desc    Get a single community post with comments
 * @access  Private
 */
router.get('/:id', authenticate, communityController.getPostById);

/**
 * @route   POST /api/community/:id/like
 * @desc    Toggle like on a post
 * @access  Private
 */
router.post('/:id/like', authenticate, communityController.toggleLike);

/**
 * @route   POST /api/community/:id/save
 * @desc    Toggle save/bookmark on a community post
 * @access  Private
 */
router.post('/:id/save', authenticate, communityController.toggleSave);

/**
 * @route   POST /api/community/:id/report
 * @desc    Report a community post
 * @access  Private
 */
router.post('/:id/report', authenticate, communityController.reportPost);

/**
 * @route   POST /api/community/:id/comment
 * @desc    Add a comment to a post
 * @access  Private
 */
router.post('/:id/comment', authenticate, communityController.addComment);

/**
 * @route   DELETE /api/community/:id
 * @desc    Delete own post (soft-delete)
 * @access  Private
 */
router.delete('/:id', authenticate, communityController.deletePost);

/**
 * @route   DELETE /api/community/:id/comment/:commentId
 * @desc    Delete own comment from a post
 * @access  Private
 */
router.delete('/:id/comment/:commentId', authenticate, communityController.deleteComment);

export default router;
