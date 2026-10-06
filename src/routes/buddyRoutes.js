import express from 'express';
import * as buddyController from '../controllers/buddyController.js';
import * as videoCallController from '../controllers/videoCallController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { noopLimiter, rateLimitEnabled, videoJoinLimiter } from '../middleware/rateLimiters.js';

const router = express.Router();
const videoLimiter = rateLimitEnabled ? videoJoinLimiter : noopLimiter;

router.get('/matches', authenticate, buddyController.getBuddyMatches);
router.get('/active', authenticate, buddyController.getActiveBuddy);
router.post('/:matchId/nominate', authenticate, buddyController.nominateBuddy);
router.get('/messages', authenticate, buddyController.getBuddyMessages);
router.post('/message', authenticate, buddyController.sendBuddyMessage);
router.delete('/active', authenticate, buddyController.endActiveBuddy);

/**
 * @route   POST /api/buddies/video/join
 * @desc    Short-lived token for the Jitsi room of the caller's active Period Buddy pairing
 * @access  Private
 */
router.post('/video/join', authenticate, videoLimiter, videoCallController.joinBuddyCall);

export default router;
