import express from 'express';
import * as schemeController from '../controllers/schemeController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// All scheme endpoints require an authenticated user (recommended/eligibility
// use the user's own Nura profile).

/**
 * @route   GET /api/schemes/categories
 * @desc    Category metadata for filter chips
 * @access  Private
 */
router.get('/categories', authenticate, schemeController.getCategories);

/**
 * @route   GET /api/schemes/recommended
 * @desc    Personalized "Recommended for You" list from the user's profile
 * @access  Private
 */
router.get('/recommended', authenticate, schemeController.getRecommendedSchemes);

/* ---------------------- Admin scheme management ---------------------- */

/**
 * @route   GET /api/schemes/admin/all
 * @desc    Full catalogue incl. inactive, for the Content Studio admin portal
 * @access  Admin
 */
router.get('/admin/all', authenticate, authorize('admin'), schemeController.adminListSchemes);

/**
 * @route   POST /api/schemes
 * @desc    Create a scheme
 * @access  Admin
 */
router.post('/', authenticate, authorize('admin'), schemeController.createScheme);

/**
 * @route   PATCH /api/schemes/:id
 * @desc    Update a scheme
 * @access  Admin
 */
router.patch('/:id', authenticate, authorize('admin'), schemeController.updateScheme);

/**
 * @route   DELETE /api/schemes/:id
 * @desc    Delete a scheme
 * @access  Admin
 */
router.delete('/:id', authenticate, authorize('admin'), schemeController.deleteScheme);

/**
 * @route   GET /api/schemes
 * @desc    Paginated, searchable, filterable scheme list
 *          (?search=&category=&state=&governmentLevel=&page=&limit=)
 * @access  Private
 */
router.get('/', authenticate, schemeController.getSchemes);

/**
 * @route   GET /api/schemes/:id/eligibility
 * @desc    Evaluate eligibility ("may be eligible" / "not eligible") from
 *          profile + optional query answers
 * @access  Private
 */
router.get('/:id/eligibility', authenticate, schemeController.checkEligibility);

/**
 * @route   GET /api/schemes/:id
 * @desc    Single scheme by id or slug
 * @access  Private
 */
router.get('/:id', authenticate, schemeController.getSchemeById);

export default router;
