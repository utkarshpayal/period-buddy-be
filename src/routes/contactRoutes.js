import express from 'express';
import * as marketingController from '../controllers/marketingController.js';
import { validateContactMessage, handleValidationErrors } from '../schemas/marketingSchema.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/contact
 * @desc    Submit the contact form — persists it and emails the team
 * @access  Public
 */
router.post(
  '/',
  validateContactMessage,
  handleValidationErrors,
  marketingController.submitContactMessage,
);

/**
 * @route   GET /api/contact
 * @desc    Admin: list contact form submissions (?status=new|read|resolved)
 * @access  Admin
 */
router.get('/', authenticate, authorize('admin'), marketingController.getContactMessages);

/**
 * @route   PATCH /api/contact/:id/status
 * @desc    Admin: update a contact message's status
 * @access  Admin
 */
router.patch(
  '/:id/status',
  authenticate,
  authorize('admin'),
  marketingController.updateContactMessageStatus,
);

export default router;
