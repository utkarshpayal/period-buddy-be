import express from 'express';
import * as subscriptionController from '../controllers/subscriptionController.js';
import { authenticate, optionalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/subscriptions/plans
 * @desc    Active bundles for the pricing/paywall screen
 * @access  Public (optional auth; doesn't personalize)
 */
router.get('/plans', optionalAuth, subscriptionController.getPlans);

/**
 * @route   GET /api/subscriptions/features
 * @desc    Active features with current free/premium status + price
 * @access  Public (optional auth)
 */
router.get('/features', optionalAuth, subscriptionController.getFeatures);

/**
 * @route   GET /api/subscriptions/pricing
 * @desc    Premium monthly/yearly with the yearly saving, the founding offer
 *          (only while live, and only if a signed-in caller is eligible),
 *          add-ons with monthly and yearly prices, tax and fair-use limits.
 *          Drawn by the app's My Subscription screen and the website.
 * @access  Public (optional auth personalizes founding-offer eligibility)
 */
router.get('/pricing', optionalAuth, subscriptionController.getPricing);

/**
 * @route   GET /api/subscriptions/me
 * @desc    The caller's own access summary (unlocked feature keys, entitlements)
 * @access  Private
 */
router.get('/me', authenticate, subscriptionController.getMySubscription);

/**
 * @route   GET /api/subscriptions/history
 * @desc    The caller's full purchase history
 * @access  Private
 */
router.get('/history', authenticate, subscriptionController.getHistory);

/**
 * @route   POST /api/subscriptions/coupons/apply
 * @desc    Preview a coupon's discount against a plan/feature before buying
 * @access  Private
 */
router.post('/coupons/apply', authenticate, subscriptionController.previewCoupon);

/**
 * @route   POST /api/subscriptions/order
 * @desc    Create a Cashfree order for a plan or a single feature (optionally
 *          discounted by a couponCode — a 100%-off code activates instantly
 *          with no order/checkout at all)
 * @access  Private
 */
router.post('/order', authenticate, subscriptionController.createSubscriptionOrder);

/**
 * @route   POST /api/subscriptions/verify
 * @desc    Verify a completed Cashfree checkout and activate the purchase
 * @access  Private
 */
router.post('/verify', authenticate, subscriptionController.verifySubscriptionPayment);

export default router;
