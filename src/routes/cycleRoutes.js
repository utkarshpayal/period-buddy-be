import express from 'express';
import * as cycleController from '../controllers/cycleController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/cycle/settings
 * @desc    Save/update user cycle settings (lastPeriodStart, cycleLength, etc.)
 * @access  Private
 */
router.post('/settings', authenticate, cycleController.saveCycleSettings);

/**
 * @route   GET /api/cycle/settings
 * @desc    Get user cycle settings
 * @access  Private
 */
router.get('/settings', authenticate, cycleController.getCycleSettings);

/**
 * @route   GET /api/cycle/predictions
 * @desc    Compute next period date, fertile window, ovulation day
 * @access  Private
 */
router.get('/predictions', authenticate, cycleController.getPredictions);

/**
 * @route   POST /api/cycle/log
 * @desc    Upsert a daily log (flow, mood, symptoms, note, energy)
 * @access  Private
 */
router.post('/log', authenticate, cycleController.saveCycleLog);

/**
 * @route   GET /api/cycle/logs
 * @desc    Get all logs optionally filtered by ?month=YYYY-MM
 * @access  Private
 */
router.get('/logs', authenticate, cycleController.getMonthLogs);

/**
 * @route   GET /api/cycle/log/:dateKey
 * @desc    Get a single day's log by dateKey (YYYY-MM-DD)
 * @access  Private
 */
router.get('/log/:dateKey', authenticate, cycleController.getDayLog);

/**
 * @route   GET /api/cycle/stats
 * @desc    Aggregated cycle stats (total days logged, top symptoms)
 * @access  Private
 */
router.get('/stats', authenticate, cycleController.getCycleStats);

export default router;
