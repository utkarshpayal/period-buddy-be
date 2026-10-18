import express from 'express';
import * as reelController from '../controllers/reelController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';
import { noopLimiter, rateLimitEnabled, reelCommentLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();
const commentLimiter = rateLimitEnabled ? reelCommentLimiter : noopLimiter;

/**
 * @route   GET /api/reels
 * @desc    Published reels, newest first (?category=&search=&page=&limit=). Each reel carries the caller's isLiked/isSaved/followedByMe/votedOptionId plus likeCount, commentCount, saveCount and viewCount
 * @access  Private
 */
router.get('/', authenticate, reelController.getReels);

/**
 * @route   GET /api/reels/saved
 * @desc    The caller's saved reels, newest save first (?page=&limit=)
 * @access  Private
 */
router.get('/saved', authenticate, reelController.getSavedReels);

/**
 * @route   GET /api/reels/:id
 * @desc    One published reel with the caller's state and counters (does not count a view)
 * @access  Private
 */
router.get('/:id', authenticate, reelController.getReelById);

/**
 * @route   POST /api/reels
 * @desc    Create a reel (legacy admin path; the Content Studio uses /api/content)
 * @access  Private (content.publish)
 */
router.post(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  reelController.createReel,
);

/**
 * @route   PUT /api/reels/:id
 * @desc    Update a reel (legacy admin path)
 * @access  Private (content.publish)
 */
router.put(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  reelController.updateReel,
);

/**
 * @route   DELETE /api/reels/:id
 * @desc    Unpublish a reel (legacy admin path)
 * @access  Private (content.publish)
 */
router.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  reelController.deleteReel,
);

/**
 * @route   PATCH /api/reels/:id/view
 * @desc    Count one view (the app calls it after ~2 s of real playback)
 * @access  Private
 */
router.patch('/:id/view', authenticate, reelController.recordView);

/**
 * @route   PATCH /api/reels/:id/follow
 * @desc    Toggle following the reel's creator
 * @access  Private
 */
router.patch('/:id/follow', authenticate, reelController.toggleFollowCreator);

/**
 * @route   POST /api/reels/:id/vote
 * @desc    Vote on the reel's poll once (body: { optionId })
 * @access  Private
 */
router.post('/:id/vote', authenticate, reelController.votePoll);

/**
 * @route   POST /api/reels/:id/like
 * @desc    Like or unlike (body: { liked: boolean }). Idempotent set, not a toggle; returns { liked, likeCount }
 * @access  Private
 */
router.post('/:id/like', authenticate, reelController.setLike);

/**
 * @route   POST /api/reels/:id/save
 * @desc    Save or unsave (body: { saved: boolean }). Idempotent set; returns { saved, saveCount }
 * @access  Private
 */
router.post('/:id/save', authenticate, reelController.setSave);

/**
 * @route   GET /api/reels/:id/comments
 * @desc    Comments, newest first (?cursor=<last comment id>&limit=, max 50) with author name/avatar; returns { comments, nextCursor, commentCount }. ?moderation=1 (content.write) includes hidden ones
 * @access  Private
 */
router.get('/:id/comments', authenticate, reelController.listComments);

/**
 * @route   POST /api/reels/:id/comments
 * @desc    Add a comment (body: { text }, at most 500 characters). Rate-limited
 * @access  Private
 */
router.post('/:id/comments', authenticate, commentLimiter, reelController.addComment);

/**
 * @route   DELETE /api/reels/:id/comments/:commentId
 * @desc    Delete a comment: its author, or staff with content.write (audited)
 * @access  Private (author or content.write)
 */
router.delete('/:id/comments/:commentId', authenticate, reelController.deleteComment);

/**
 * @route   POST /api/reels/:id/comments/:commentId/report
 * @desc    Report a comment once; hidden for everyone after 5 reports
 * @access  Private
 */
router.post(
  '/:id/comments/:commentId/report',
  authenticate,
  commentLimiter,
  reelController.reportComment,
);

export default router;
