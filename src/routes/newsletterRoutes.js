import express from 'express';
import * as marketingController from '../controllers/marketingController.js';
import { validateNewsletterSubscribe, handleValidationErrors } from '../schemas/marketingSchema.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/newsletter/subscribe
 * @desc    Subscribe an email to the newsletter
 * @access  Public
 */
router.post(
  '/subscribe',
  validateNewsletterSubscribe,
  handleValidationErrors,
  marketingController.subscribeNewsletter,
);

/**
 * @route   POST /api/newsletter/unsubscribe
 * @desc    Unsubscribe an email from the newsletter
 * @access  Public
 */
router.post('/unsubscribe', marketingController.unsubscribeNewsletter);

/**
 * @route   GET /api/newsletter
 * @desc    Admin: list active subscribers
 * @access  Admin
 */
router.get('/', authenticate, authorize('admin'), marketingController.getNewsletterSubscribers);

export default router;
