import express from 'express';
import * as schemeController from '../controllers/schemeController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

/* ── Admin review queue (declared before /:id so "admin" isn't read as an id) ── */

/**
 * @route   GET /api/scheme-applications/admin/all
 * @desc    Every user's applications for the admin review queue
 *          (?status=&schemeId=&search=&page=&limit=)
 * @access  Admin
 */
router.get('/admin/all', authenticate, authorize('admin'), schemeController.adminListApplications);

/**
 * @route   GET /api/scheme-applications/admin/filters
 * @desc    Status counts + distinct applicant states + schemes-with-applications
 *          for the admin queue's filter controls
 * @access  Admin
 */
router.get(
  '/admin/filters',
  authenticate,
  authorize('admin'),
  schemeController.adminApplicationFilters,
);

/**
 * @route   PATCH /api/scheme-applications/admin/:id
 * @desc    Admin approves / declines / reviews an application
 * @access  Admin
 */
router.patch(
  '/admin/:id',
  authenticate,
  authorize('admin'),
  schemeController.adminReviewApplication,
);

/**
 * @route   POST /api/scheme-applications
 * @desc    Create a self-service application record for an APPLY-type scheme
 * @access  Private
 * @note    Gated behind 'government_scheme_applications' via the global
 *          feature-route registry (config/subscriptionRouteRegistry.js).
 */
router.post('/', authenticate, schemeController.createApplication);

/**
 * @route   GET /api/scheme-applications
 * @desc    The user's applications, newest first (?status=)
 * @access  Private
 */
router.get('/', authenticate, schemeController.getApplications);

/**
 * @route   GET /api/scheme-applications/:id
 * @desc    A single application owned by the user
 * @access  Private
 */
router.get('/:id', authenticate, schemeController.getApplicationById);

/**
 * @route   PATCH /api/scheme-applications/:id
 * @desc    Update the user's own application (status / notes / formData / documents)
 * @access  Private
 */
router.patch('/:id', authenticate, schemeController.updateApplication);

export default router;
