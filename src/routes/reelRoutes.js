import express from 'express';
import * as reelController from '../controllers/reelController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

router.get('/', authenticate, reelController.getReels);
router.get('/:id', authenticate, reelController.getReelById);
router.post(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  reelController.createReel,
);
router.put(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  reelController.updateReel,
);
router.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  reelController.deleteReel,
);
router.patch('/:id/view', authenticate, reelController.recordView);
router.patch('/:id/follow', authenticate, reelController.toggleFollowCreator);
router.post('/:id/vote', authenticate, reelController.votePoll);

export default router;
