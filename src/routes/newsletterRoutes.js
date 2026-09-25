import express from 'express';
import * as marketingController from '../controllers/marketingController.js';
import { validateNewsletterSubscribe, handleValidationErrors } from '../schemas/marketingSchema.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';

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
 * @route   GET /api/newsletter/unsubscribe
 * @desc    One-click unsubscribe for the plain `<a href>` link in emails —
 *          a mail client can't fire the POST above, so this exists purely
 *          to make that link actually work, and returns a small HTML page.
 * @access  Public
 */
router.get('/unsubscribe', marketingController.unsubscribeNewsletterViaLink);

/**
 * @route   GET /api/newsletter
 * @desc    Admin: list active subscribers
 * @access  Admin
 */
router.get(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.MARKETING_READ),
  marketingController.getNewsletterSubscribers,
);

export default router;
