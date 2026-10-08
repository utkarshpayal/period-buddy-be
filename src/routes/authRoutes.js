import express from 'express';
import * as authController from '../controllers/authController.js';
import * as twoFactorController from '../controllers/twoFactorController.js';
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
 * @route   POST /api/auth/login/verify-code
 * @desc    Second sign-in step for staff and doctors: the emailed code
 *          (body { challengeToken, code }). Answers like /login.
 * @access  Public
 */
router.post('/login/verify-code', sensitiveLimiter, authController.verifyLoginCode);

/**
 * @route   POST /api/auth/login/resend-code
 * @desc    Email a new sign-in code for the same challenge
 * @access  Public
 */
router.post('/login/resend-code', sensitiveLimiter, authController.resendLoginCode);

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
 * @route   POST /api/auth/logout-all
 * @desc    Sign out of every device, this one included (all sessions and older tokens stop working)
 * @access  Private
 */
router.post('/logout-all', authenticate, authController.logoutAll);

/**
 * @route   GET /api/auth/sessions
 * @desc    Signed-in devices: { sessions: [{ id, platform, appVersion, userAgent, signedInAt, lastActiveAt, expiresAt, current }] }
 * @access  Private
 */
router.get('/sessions', authenticate, authController.getSessions);

/**
 * @route   DELETE /api/auth/sessions/:id
 * @desc    Sign one device out
 * @access  Private
 */
router.delete('/sessions/:id', authenticate, authController.endSession);

/**
 * @route   GET /api/auth/privacy
 * @desc    Privacy choices: { consents: { aiProcessing: { granted (null = never asked), version, updatedAt, currentVersion, providers, allowedNow } } }
 * @access  Private
 */
router.get('/privacy', authenticate, authController.getPrivacy);

/**
 * @route   PUT /api/auth/privacy/ai-consent
 * @desc    Allow or refuse sending your content to the AI provider. Body: { granted: boolean }
 * @access  Private
 */
router.put('/privacy/ai-consent', authenticate, authController.setAiConsent);

/**
 * @route   PUT /api/auth/privacy/settings
 * @desc    Save privacy settings: { hideNotificationDetails?, aiChatRetentionDays?, newSignInAlerts? }
 * @access  Private
 */
router.put('/privacy/settings', authenticate, authController.setPrivacySettings);

/**
 * @route   GET /api/auth/home-layout
 * @desc    This person's Home layout: { order, hidden, shortcuts (null = app default), shortcutStyles, blocks, updatedAt }
 * @access  Private
 */
router.get('/home-layout', authenticate, authController.getHomeLayout);

/**
 * @route   PUT /api/auth/home-layout
 * @desc    Replace the Home layout. Body: { order: string[], hidden: string[], shortcuts: string[] | null, shortcutStyles?: { [key]: { look: 'icon'|'tile'|'card', color, label, icon } }, blocks?: { [blockKey]: { title, items } } }
 * @access  Private
 */
router.put('/home-layout', authenticate, authController.saveHomeLayout);

/**
 * @route   GET /api/auth/2fa
 * @desc    Staff/doctor two-step sign-in status: { required, method, totpEnabledAt, recoveryCodesLeft }
 * @access  Private (staff and doctors)
 */
router.get('/2fa', authenticate, twoFactorController.getTwoFactor);

/**
 * @route   POST /api/auth/2fa/totp/setup
 * @desc    Start setting up an authenticator app: { secret, otpauthUrl } to scan
 * @access  Private (staff and doctors)
 */
router.post('/2fa/totp/setup', authenticate, twoFactorController.setupTotp);

/**
 * @route   POST /api/auth/2fa/totp/enable
 * @desc    Finish setup with a first code ({ code }); returns the recovery codes, shown once
 * @access  Private (staff and doctors)
 */
router.post('/2fa/totp/enable', authenticate, sensitiveLimiter, twoFactorController.enableTotp);

/**
 * @route   POST /api/auth/2fa/totp/disable
 * @desc    Turn the authenticator app off ({ password }); back to emailed codes
 * @access  Private (staff and doctors)
 */
router.post('/2fa/totp/disable', authenticate, sensitiveLimiter, twoFactorController.disableTotp);

/**
 * @route   POST /api/auth/2fa/recovery-codes
 * @desc    Replace the recovery codes ({ password }); returns the new ones, shown once
 * @access  Private (staff and doctors)
 */
router.post(
  '/2fa/recovery-codes',
  authenticate,
  sensitiveLimiter,
  twoFactorController.regenerateRecoveryCodes,
);

/**
 * @route   GET /api/auth/export-data
 * @desc    Download everything stored about you as JSON (at most once every 5 minutes)
 * @access  Private
 */
router.get('/export-data', authenticate, authController.exportData);

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
