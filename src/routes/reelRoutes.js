import express from 'express';
import * as reelController from '../controllers/reelController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/', authenticate, reelController.getReels);
router.get('/:id', authenticate, reelController.getReelById);
router.post('/', authenticate, authorize('admin'), reelController.createReel);
router.put('/:id', authenticate, authorize('admin'), reelController.updateReel);
router.delete('/:id', authenticate, authorize('admin'), reelController.deleteReel);
router.patch('/:id/view', authenticate, reelController.recordView);
router.patch('/:id/follow', authenticate, reelController.toggleFollowCreator);
router.post('/:id/vote', authenticate, reelController.votePoll);

export default router;
