import express from 'express';
import * as schemeController from '../controllers/schemeController.js';
import mongoose from 'mongoose';
import GovernmentBenefit from '../models/GovernmentBenefit.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { withApproval } from '../middleware/approvalGate.js';
import { PERMISSIONS, DEPARTMENTS } from '../config/permissions.js';

const router = express.Router();

const canWriteContent = requirePermission(PERMISSIONS.CONTENT_WRITE);

// Schemes are live the moment they're saved, so every change a Content Admin
// makes to the catalog goes through a Content Super Admin.
const schemeGate = {
  directPermission: PERMISSIONS.CONTENT_PUBLISH,
  department: DEPARTMENTS.CONTENT,
  resourceType: 'scheme',
  snapshot: async (req) =>
    mongoose.isValidObjectId(req.params.id)
      ? (await GovernmentBenefit.findById(req.params.id).lean()) || undefined
      : undefined,
};

// Unknown ids skip the queue so the controller can 404 immediately.
const schemeExists = async (req) =>
  mongoose.isValidObjectId(req.params.id) &&
  Boolean(await GovernmentBenefit.exists({ _id: req.params.id }));

const schemeName = (req, before) => before?.name || req.body?.name || 'scheme';

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
router.get(
  '/admin/all',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_READ),
  schemeController.adminListSchemes,
);

/**
 * @route   POST /api/schemes
 * @desc    Create a scheme
 * @access  Admin
 */
router.post(
  '/',
  authenticate,
  canWriteContent,
  withApproval(
    {
      ...schemeGate,
      key: 'scheme.create',
      action: 'create',
      summarize: (req) => `Add scheme "${schemeName(req)}"`,
    },
    schemeController.createScheme,
  ),
);

/**
 * @route   PATCH /api/schemes/:id
 * @desc    Update a scheme
 * @access  Admin
 */
router.patch(
  '/:id',
  authenticate,
  canWriteContent,
  withApproval(
    {
      ...schemeGate,
      key: 'scheme.update',
      action: 'update',
      needsApproval: schemeExists,
      summarize: (req, before) => `Edit scheme "${schemeName(req, before)}"`,
    },
    schemeController.updateScheme,
  ),
);

/**
 * @route   DELETE /api/schemes/:id
 * @desc    Delete a scheme
 * @access  Admin
 */
router.delete(
  '/:id',
  authenticate,
  canWriteContent,
  withApproval(
    {
      ...schemeGate,
      key: 'scheme.delete',
      action: 'delete',
      needsApproval: schemeExists,
      summarize: (req, before) => `Remove scheme "${schemeName(req, before)}"`,
    },
    schemeController.deleteScheme,
  ),
);

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
