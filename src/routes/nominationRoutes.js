import express from 'express';
import * as nominationController from '../controllers/nominationController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/nominations
 * @desc    Get all nominations sent by the current user
 * @access  Private
 */
router.get('/', authenticate, nominationController.getMyNominations);

/**
 * @route   GET /api/nominations/incoming
 * @desc    Get all nominations received by the current user
 * @access  Private
 */
router.get('/incoming', authenticate, nominationController.getIncomingNominations);

/**
 * @route   POST /api/nominations
 * @desc    Nominate a buddy by email with optional message
 * @access  Private
 */
router.post('/', authenticate, nominationController.nominateBuddy);

/**
 * @route   PATCH /api/nominations/:id/respond
 * @desc    Accept or decline an incoming nomination
 * @access  Private
 */
router.patch('/:id/respond', authenticate, nominationController.respondToNomination);

export default router;
