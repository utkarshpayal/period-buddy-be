import express from 'express';
import * as doctorController from '../controllers/doctorController.js';
import * as twoFactorController from '../controllers/twoFactorController.js';
import * as walletController from '../controllers/doctorWalletController.js';
import { uploadContentMedia } from '../controllers/uploadController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';
import { imageUpload, mediaUpload } from '../middleware/mediaUpload.js';
import { authLimiter, noopLimiter, rateLimitEnabled } from '../middleware/rateLimiters.js';

const router = express.Router();

/* ---------------------------------------------------------------------------
 * Public — accept an invite
 * ------------------------------------------------------------------------- */

/**
 * @route   POST /api/doctor/set-password
 * @desc    Set password from an invite token and log in
 * @access  Public
 */
router.post('/set-password', doctorController.setPasswordFromInvite);

/* ---------------------------------------------------------------------------
 * Admin — invite & manage gynecologists
 * ------------------------------------------------------------------------- */

router.post(
  '/invite',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  doctorController.inviteDoctor,
);
router.get(
  '/admin/list',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_READ),
  doctorController.listDoctorsForAdmin,
);
router.patch(
  '/admin/:id',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  doctorController.updateDoctorByAdmin,
);
/**
 * @route   POST /api/doctor/admin/:id/avatar
 * @desc    Set a doctor's profile photo (multipart `file`, image up to 5 MB);
 *          DELETE removes it
 * @access  Private (doctors.manage)
 */
router.post(
  '/admin/:id/avatar',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  imageUpload.single('file'),
  doctorController.uploadDoctorAvatarByAdmin,
);
router.delete(
  '/admin/:id/avatar',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  doctorController.removeDoctorAvatarByAdmin,
);
router.post(
  '/admin/:id/resend-invite',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  doctorController.resendInvite,
);
/**
 * @route   POST /api/doctor/admin/:id/reset-2fa
 * @desc    Turn off a doctor's authenticator app (lost phone and recovery codes)
 * @access  Private (doctors.manage)
 */
router.post(
  '/admin/:id/reset-2fa',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  twoFactorController.resetDoctorTwoFactor,
);
router.delete(
  '/admin/:id',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  doctorController.deactivateDoctor,
);
/**
 * @route   POST /api/doctor/admin/:id/reactivate
 * @desc    Undo a deactivation (login and weekly slots back, bookings stay paused)
 * @access  Private (doctors.manage)
 */
router.post(
  '/admin/:id/reactivate',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  doctorController.reactivateDoctor,
);
/**
 * @route   DELETE /api/doctor/admin/:id/account
 * @desc    Delete a doctor for good (refused while their wallet holds money)
 * @access  Private (doctors.manage)
 */
router.delete(
  '/admin/:id/account',
  authenticate,
  requirePermission(PERMISSIONS.DOCTORS_MANAGE),
  doctorController.deleteDoctorAccount,
);

/* ---------------------------------------------------------------------------
 * Doctor — everything below requires the doctor role
 * ------------------------------------------------------------------------- */

router.get('/me', authenticate, authorize('doctor'), doctorController.getMyProfile);
router.put('/me', authenticate, authorize('doctor'), doctorController.updateMyProfile);
/**
 * @route   POST /api/doctor/me/avatar
 * @desc    Upload own profile photo (multipart `file`, image up to 5 MB); DELETE removes it
 * @access  Private (doctor)
 */
router.post(
  '/me/avatar',
  authenticate,
  authorize('doctor'),
  imageUpload.single('file'),
  doctorController.uploadMyAvatar,
);
router.delete('/me/avatar', authenticate, authorize('doctor'), doctorController.removeMyAvatar);

router.get('/dashboard', authenticate, authorize('doctor'), doctorController.getDashboard);

router.get('/consultations', authenticate, authorize('doctor'), doctorController.getConsultations);
router.get(
  '/consultations/:id/patient',
  authenticate,
  authorize('doctor'),
  doctorController.getConsultationPatient,
);
router.get(
  '/consultations/:id/messages',
  authenticate,
  authorize('doctor'),
  doctorController.getConsultationMessages,
);
router.post(
  '/consultations/:id/message',
  authenticate,
  authorize('doctor'),
  doctorController.sendConsultationMessage,
);
router.post(
  '/consultations/:id/call',
  authenticate,
  authorize('doctor'),
  doctorController.startVideoCall,
);
router.patch(
  '/consultations/:id/prescription',
  authenticate,
  authorize('doctor'),
  doctorController.setPrescription,
);
router.patch(
  '/consultations/:id/complete',
  authenticate,
  authorize('doctor'),
  doctorController.completeConsultation,
);
router.patch(
  '/consultations/:id/cancel',
  authenticate,
  authorize('doctor'),
  doctorController.cancelConsultation,
);

router.get('/payments', authenticate, authorize('doctor'), doctorController.getPayments);

/* ---------------------------------------------------------------------------
 * Doctor — wallet & withdrawals (utils/doctorWallet.js)
 * ------------------------------------------------------------------------- */

// Adding a payout method checks the password: cap wrong guesses like login.
const passwordLimiter = rateLimitEnabled ? authLimiter : noopLimiter;
const doctorOnly = [authenticate, authorize('doctor')];

/**
 * @route   GET /api/doctor/wallet
 * @desc    Wallet balances (available, on hold, withdrawn), commission and withdrawal rules, payout methods
 * @access  Private (doctor)
 */
router.get('/wallet', ...doctorOnly, walletController.getWallet);

/**
 * @route   GET /api/doctor/wallet/payouts
 * @desc    The doctor's withdrawals, newest first (?page=&limit=)
 * @access  Private (doctor)
 */
router.get('/wallet/payouts', ...doctorOnly, walletController.getMyPayouts);

/**
 * @route   POST /api/doctor/wallet/payouts
 * @desc    Request a withdrawal { amount, methodId } with an Idempotency-Key header
 * @access  Private (doctor)
 */
router.post('/wallet/payouts', ...doctorOnly, walletController.createPayoutRequest);

/**
 * @route   POST /api/doctor/wallet/payouts/:id/cancel
 * @desc    Cancel a withdrawal that is still awaiting approval
 * @access  Private (doctor)
 */
router.post('/wallet/payouts/:id/cancel', ...doctorOnly, walletController.cancelMyPayout);

/**
 * @route   POST /api/doctor/wallet/methods
 * @desc    Add a bank account or UPI ID for withdrawals (needs the account password)
 * @access  Private (doctor)
 */
router.post('/wallet/methods', passwordLimiter, ...doctorOnly, walletController.addMethod);

/**
 * @route   DELETE /api/doctor/wallet/methods/:id
 * @desc    Remove a payout method
 * @access  Private (doctor)
 */
router.delete('/wallet/methods/:id', ...doctorOnly, walletController.removeMethod);

/**
 * @route   POST /api/doctor/wallet/methods/:id/default
 * @desc    Make a payout method the default
 * @access  Private (doctor)
 */
router.post('/wallet/methods/:id/default', ...doctorOnly, walletController.makeDefaultMethod);

router.get('/availability', authenticate, authorize('doctor'), doctorController.getAvailability);
router.put('/availability', authenticate, authorize('doctor'), doctorController.setAvailability);

// Reel video / thumbnail uploads for the clinician portal — same S3 handler
// as the admin content upload, but scoped to the doctor role.
router.post(
  '/media/upload',
  authenticate,
  authorize('doctor'),
  mediaUpload.single('file'),
  uploadContentMedia,
);

router.get('/reels', authenticate, authorize('doctor'), doctorController.getMyReels);
router.post('/reels', authenticate, authorize('doctor'), doctorController.createReel);
router.put('/reels/:id', authenticate, authorize('doctor'), doctorController.updateReel);
router.delete('/reels/:id', authenticate, authorize('doctor'), doctorController.deleteReel);

export default router;
