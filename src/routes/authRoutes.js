import express from 'express';
import * as authController from '../controllers/authController.js';
import {
  validateChangePassword,
  validateDeleteAccount,
  validateLogin,
  validateOnboarding,
  validateProfileUpdate,
  validateSignup,
  handleValidationErrors,
} from '../schemas/authSchema.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/auth/signup
 * @desc    Register a new user
 * @access  Public
 */
router.post('/signup', validateSignup, handleValidationErrors, authController.signup);

/**
 * @route   POST /api/auth/login
 * @desc    Login user
 * @access  Public
 */
router.post('/login', validateLogin, handleValidationErrors, authController.login);

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
