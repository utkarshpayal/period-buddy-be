import express from 'express';
import * as genzController from '../controllers/genzController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/genz/wrapped
 * @desc    Cycle Wrapped stats for a month or year. Query: period (month | year), value (YYYY-MM | YYYY, default current), tz (getTimezoneOffset minutes)
 * @access  Private
 */
router.get('/wrapped', authenticate, genzController.getWrapped);

/**
 * @route   GET /api/genz/era
 * @desc    Today's cycle phase "era" (name, aura, days left) and phase-matched cycle-syncing tips (move, fuel, selfCare, vibe)
 * @access  Private
 */
router.get('/era', authenticate, genzController.getEra);

/**
 * @route   GET /api/genz/badges
 * @desc    Current and longest logging streak, next milestone, and every badge with earned state and progress
 * @access  Private
 */
router.get('/badges', authenticate, genzController.getBadges);

export default router;
