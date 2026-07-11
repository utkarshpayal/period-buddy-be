import express from 'express';
import * as habitController from '../controllers/habitController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/habits
 * @desc    Get user's active habits with today's completion status
 * @access  Private
 */
router.get('/', authenticate, habitController.getHabits);

/**
 * @route   POST /api/habits
 * @desc    Create a new habit
 * @access  Private
 */
router.post('/', authenticate, habitController.createHabit);

/**
 * @route   PATCH /api/habits/:id/toggle
 * @desc    Toggle habit completion for today (earn/lose tokens, update streak)
 * @access  Private
 */
router.patch('/:id/toggle', authenticate, habitController.toggleHabit);

/**
 * @route   DELETE /api/habits/:id
 * @desc    Soft-delete a habit
 * @access  Private
 */
router.delete('/:id', authenticate, habitController.deleteHabit);

export default router;
