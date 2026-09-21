import express from 'express';
import * as authController from '../controllers/authController.js';
import {
  validateChangePassword,
  validateDeleteAccount,
  validateGoogleAuth,
  validateLogin,
  validateOnboarding,
  validateProfileUpdate,
  validateResendOtp,
  validateSignup,
  validateVerifyOtp,
  validateRequestSelfDeletion,
  validateConfirmSelfDeletion,
  handleValidationErrors,
} from '../schemas/authSchema.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  authLimiter,
  otpEmailLimiter,
  rateLimitEnabled,
  noopLimiter,
} from '../middleware/rateLimiters.js';

const router = express.Router();

// Strict brute-force guard on unauthenticated, sensitive endpoints. No-op when
// rate limiting is disabled (dev) so local flows aren't throttled.
const sensitiveLimiter = rateLimitEnabled ? authLimiter : noopLimiter;
// Email-scoped OTP guard, independent of the IP-keyed limiter above — see
// otpEmailLimiter's own comment for why verify-otp/resend-otp need this in
// addition to sensitiveLimiter.
const otpLimiter = rateLimitEnabled ? otpEmailLimiter : noopLimiter;

/**
 * @route   POST /api/auth/signup
 * @desc    Start registration: stash signup data + email an OTP. No user
 *          account exists yet — see POST /verify-otp.
 * @access  Public
 */
router.post(
  '/signup',
  sensitiveLimiter,
  validateSignup,
  handleValidationErrors,
  authController.signup,
);

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify the OTP for a pending signup and create the user account
 * @access  Public
 */
router.post(
  '/verify-otp',
  sensitiveLimiter,
  otpLimiter,
  validateVerifyOtp,
  handleValidationErrors,
  authController.verifyOtp,
);

/**
 * @route   POST /api/auth/resend-otp
 * @desc    Resend a fresh OTP for a pending signup
 * @access  Public
 */
router.post(
  '/resend-otp',
  sensitiveLimiter,
  otpLimiter,
  validateResendOtp,
  handleValidationErrors,
  authController.resendOtp,
);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post(
  '/login',
  sensitiveLimiter,
  validateLogin,
  handleValidationErrors,
  authController.login,
);

/**
 * @route   POST /api/auth/google
 * @desc    Sign in (or sign up) with a Google ID token
 * @access  Public
 */
router.post(
  '/google',
  sensitiveLimiter,
  validateGoogleAuth,
  handleValidationErrors,
  authController.googleAuth,
);

/**
 * @route   POST /api/auth/onboarding
 * @desc    Complete onboarding process
 * @access  Private
 */
router.post(
  '/onboarding',
  authenticate,
  validateOnboarding,
  handleValidationErrors,
  authController.onboarding,
);

/**
 * @route   GET /api/auth/profile
 * @desc    Get current user profile
 * @access  Private
 */
router.get('/profile', authenticate, authController.getProfile);

/**
 * @route   PUT /api/auth/profile
 * @desc    Update user profile
 * @access  Private
 */
router.put(
  '/profile',
  authenticate,
  validateProfileUpdate,
  handleValidationErrors,
  authController.updateProfile,
);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post(
  '/change-password',
  authenticate,
  validateChangePassword,
  handleValidationErrors,
  authController.changePassword,
);

/**
 * @route   POST /api/auth/logout
 * @desc    Logout user
 * @access  Private
 */
router.post('/logout', authenticate, authController.logout);

/**
 * @route   DELETE /api/auth/delete-account
 * @desc    Delete user account
 * @access  Private
 */
router.delete(
  '/delete-account',
  authenticate,
  validateDeleteAccount,
  handleValidationErrors,
  authController.deleteAccount,
);

/**
 * @route   POST /api/auth/account/delete/request
 * @desc    Self-service deletion, step 1 (public, unauthenticated). Emails a
 *          one-time code to the given address if it belongs to an account —
 *          nothing is deleted yet. Backs the marketing site's unlisted
 *          "delete my data" page; deliberately not gated behind login, since
 *          the whole point is to work even without access to the app.
 * @access  Public
 */
router.post(
  '/account/delete/request',
  sensitiveLimiter,
  validateRequestSelfDeletion,
  handleValidationErrors,
  authController.requestSelfDeletion,
);

/**
 * @route   POST /api/auth/account/delete/confirm
 * @desc    Self-service deletion, step 2 (public, unauthenticated). Verifies
 *          the code from step 1 and permanently deletes the account and all
 *          of its data. Irreversible.
 * @access  Public
 */
router.post(
  '/account/delete/confirm',
  sensitiveLimiter,
  validateConfirmSelfDeletion,
  handleValidationErrors,
  authController.confirmSelfDeletion,
);

/**
 * @route   GET /api/auth/dashboard
 * @desc    Get lightweight home dashboard summary
 * @access  Private
 */
router.get('/dashboard', authenticate, authController.getDashboardSummary);

/**
 * @route   POST /api/auth/fcm-token
 * @desc    Update FCM/Push Notification token for the authenticated user
 * @access  Private
 */
router.post('/fcm-token', authenticate, authController.updateFcmToken);

export default router;
