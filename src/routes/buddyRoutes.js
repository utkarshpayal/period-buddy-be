import express from 'express';
import * as buddyController from '../controllers/buddyController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/matches', authenticate, buddyController.getBuddyMatches);
router.get('/active', authenticate, buddyController.getActiveBuddy);
router.post('/:matchId/nominate', authenticate, buddyController.nominateBuddy);
router.get('/messages', authenticate, buddyController.getBuddyMessages);
router.post('/message', authenticate, buddyController.sendBuddyMessage);
router.delete('/active', authenticate, buddyController.endActiveBuddy);

export default router;
