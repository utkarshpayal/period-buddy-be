import express from 'express';
import * as insightController from '../controllers/insightController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/insights/daily
 * @desc    Rule-based daily personalized insights (phase, mood, energy, suggestions)
 * @access  Private
 */
router.get('/daily', authenticate, insightController.getDailyInsights);

export default router;
