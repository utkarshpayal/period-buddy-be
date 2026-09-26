import express from 'express';
import * as circleController from '../controllers/circleController.js';
import { authenticate } from '../middleware/authMiddleware.js';

// Bestie Circles: small private friend groups that share a status emoji,
// optionally their phase emoji, and hype. Every route is members-only; a
// circle you aren't in answers 404.
const router = express.Router();
router.use(authenticate);

/**
 * @route   GET /api/circles
 * @desc    The caller's circles with each one's latest vibe, most recently active first
 * @access  Private
 */
router.get('/', circleController.listCircles);
/**
 * @route   POST /api/circles
 * @desc    Create a circle. Body: { name, emoji? }. Returns its invite code
 * @access  Private
 */
router.post('/', circleController.createCircle);
/**
 * @route   POST /api/circles/join
 * @desc    Join a circle by invite code. Body: { code }
 * @access  Private
 */
router.post('/join', circleController.joinCircle);
/**
 * @route   GET /api/circles/:id
 * @desc    Circle detail: invite code, members with their latest vibe, and the vibe feed (last 7 days)
 * @access  Private (member)
 */
router.get('/:id', circleController.getCircle);
/**
 * @route   PATCH /api/circles/:id
 * @desc    Rename a circle. Body: { name, emoji? }
 * @access  Private (owner)
 */
router.patch('/:id', circleController.updateCircle);
/**
 * @route   POST /api/circles/:id/invite-code
 * @desc    Replace the circle's invite code (the old one stops working)
 * @access  Private (owner)
 */
router.post('/:id/invite-code', circleController.resetInviteCode);
/**
 * @route   DELETE /api/circles/:id/members/:userId
 * @desc    Leave (userId "me") or remove a member (owner). The last member leaving deletes the circle
 * @access  Private (member)
 */
router.delete('/:id/members/:userId', circleController.removeMember);
/**
 * @route   POST /api/circles/:id/vibes
 * @desc    Post a vibe. Body: { emoji, text? (≤80), sharePhase?, askForSupport? }. askForSupport pushes the other members
 * @access  Private (member)
 */
router.post('/:id/vibes', circleController.postVibe);
/**
 * @route   DELETE /api/circles/:id/vibes/:vibeId
 * @desc    Delete one of your own vibes
 * @access  Private (member)
 */
router.delete('/:id/vibes/:vibeId', circleController.deleteVibe);
/**
 * @route   POST /api/circles/:id/vibes/:vibeId/react
 * @desc    Toggle a reaction on a vibe. Body: { emoji } (one of the circle reactions)
 * @access  Private (member)
 */
router.post('/:id/vibes/:vibeId/react', circleController.reactToVibe);
/**
 * @route   POST /api/circles/:id/hype/:userId
 * @desc    Send a member a hype push (once per 6h per member)
 * @access  Private (member)
 */
router.post('/:id/hype/:userId', circleController.sendHype);

export default router;
