import express from 'express';
import * as wellbeingController from '../controllers/wellbeingController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/wellbeing
 * @desc    Get wellbeing resources (?type=sexual_wellbeing|hygiene)
 * @access  Private
 */
router.get('/', authenticate, wellbeingController.getResources);

/**
 * @route   GET /api/wellbeing/games
 * @desc    Get wellbeing game decks (?deck=spark|positions)
 * @access  Private
 */
router.get('/games', authenticate, wellbeingController.getGameDecks);

/**
 * @route   POST /api/wellbeing/games/:deck/draw
 * @desc    Draw a wellbeing game card and award tokens
 * @access  Private
 */
router.post('/games/:deck/draw', authenticate, wellbeingController.drawGameCard);

/**
 * @route   GET /api/wellbeing/:id
 * @desc    Get single wellbeing resource detail
 * @access  Private
 */
router.get('/:id', authenticate, wellbeingController.getResourceById);

/**
 * @route   POST /api/wellbeing/:id/track-view
 * @desc    Report real reading dwell time for a wellbeing resource
 * @access  Private
 */
router.post('/:id/track-view', authenticate, wellbeingController.trackResourceView);

/**
 * @route   POST /api/wellbeing
 * @desc    Admin: Create a wellbeing resource
 * @access  Admin
 */
router.post('/', authenticate, authorize('admin'), wellbeingController.createResource);

/**
 * @route   PUT /api/wellbeing/:id
 * @desc    Admin: Update a wellbeing resource
 * @access  Admin
 */
router.put('/:id', authenticate, authorize('admin'), wellbeingController.updateResource);

/**
 * @route   DELETE /api/wellbeing/:id
 * @desc    Admin: Soft-delete a wellbeing resource
 * @access  Admin
 */
router.delete('/:id', authenticate, authorize('admin'), wellbeingController.deleteResource);

export default router;
