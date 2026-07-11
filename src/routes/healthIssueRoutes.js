import express from 'express';
import * as healthController from '../controllers/healthIssueController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/health-issues
 * @desc    Get all active health issues (encyclopedia)
 * @access  Private
 */
router.get('/', authenticate, healthController.getHealthIssues);

/**
 * @route   GET /api/health-issues/:id
 * @desc    Get a single health issue by ID
 * @access  Private
 */
router.get('/:id', authenticate, healthController.getHealthIssueById);

/**
 * @route   POST /api/health-issues
 * @desc    Admin: Create a health issue entry
 * @access  Admin
 */
router.post('/', authenticate, authorize('admin'), healthController.createHealthIssue);

/**
 * @route   PUT /api/health-issues/:id
 * @desc    Admin: Update a health issue entry
 * @access  Admin
 */
router.put('/:id', authenticate, authorize('admin'), healthController.updateHealthIssue);

/**
 * @route   DELETE /api/health-issues/:id
 * @desc    Admin: Soft-delete a health issue entry
 * @access  Admin
 */
router.delete('/:id', authenticate, authorize('admin'), healthController.deleteHealthIssue);

export default router;
