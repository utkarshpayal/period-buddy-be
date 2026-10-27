import express from 'express';
import * as forestController from '../controllers/forestController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/status', authenticate, forestController.getForestStatus);
router.post('/care', authenticate, forestController.logForestCare);
router.get('/logs', authenticate, forestController.getForestLogs);

/**
 * @route   GET /api/forest/garden
 * @desc    The tree-care game's live state (moisture, nutrients, weeds, pests, dry leaves, supplies, level)
 * @access  Private
 */
router.get('/garden', authenticate, forestController.getGarden);

/**
 * @route   POST /api/forest/garden/action
 * @desc    A care action: water (seconds), weed/shoo/prune (id), fertilize, mulch
 * @access  Private
 */
router.post('/garden/action', authenticate, forestController.gardenAction);

export default router;
