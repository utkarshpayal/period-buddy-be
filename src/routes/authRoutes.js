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
  handleValidationErrors,
} from '../schemas/authSchema.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/auth/signup
 * @desc    Start registration: stash signup data + email an OTP. No user
 *          account exists yet — see POST /verify-otp.
 * @access  Public
 */
router.post('/signup', validateSignup, handleValidationErrors, authController.signup);

/**
 * @route   POST /api/auth/verify-otp
 * @desc    Verify the OTP for a pending signup and create the user account
 * @access  Public
 */
router.post('/verify-otp', validateVerifyOtp, handleValidationErrors, authController.verifyOtp);

/**
 * @route   POST /api/auth/resend-otp
 * @desc    Resend a fresh OTP for a pending signup
 * @access  Public
 */
router.post('/resend-otp', validateResendOtp, handleValidationErrors, authController.resendOtp);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', validateLogin, handleValidationErrors, authController.login);

/**
 * @route   POST /api/auth/google
 * @desc    Sign in (or sign up) with a Google ID token
 * @access  Public
 */
router.post('/google', validateGoogleAuth, handleValidationErrors, authController.googleAuth);

/**
 * @route   POST /api/auth/onboarding
 * @desc    Complete onboarding process
 * @access  Private
 */
router.post('/onboarding', authenticate, validateOnboarding, handleValidationErrors, authController.onboarding);


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
router.put('/profile', authenticate, validateProfileUpdate, handleValidationErrors, authController.updateProfile);

/**
 * @route   POST /api/auth/change-password
 * @desc    Change user password
 * @access  Private
 */
router.post('/change-password', authenticate, validateChangePassword, handleValidationErrors, authController.changePassword);

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
router.delete('/delete-account', authenticate, validateDeleteAccount, handleValidationErrors, authController.deleteAccount);

/**
 * @route   GET /api/auth/dashboard
 * @desc    Get lightweight home dashboard summary
 * @access  Private
 */
router.get('/dashboard', authenticate, authController.getDashboardSummary);

export default router;
