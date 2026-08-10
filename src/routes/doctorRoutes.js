import express from 'express';
import * as doctorController from '../controllers/doctorController.js';
import { uploadContentMedia } from '../controllers/uploadController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import { mediaUpload } from '../middleware/mediaUpload.js';

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

router.post('/invite', authenticate, authorize('admin'), doctorController.inviteDoctor);
router.get('/admin/list', authenticate, authorize('admin'), doctorController.listDoctorsForAdmin);
router.patch('/admin/:id', authenticate, authorize('admin'), doctorController.updateDoctorByAdmin);
router.post(
  '/admin/:id/resend-invite',
  authenticate,
  authorize('admin'),
  doctorController.resendInvite,
);
router.delete('/admin/:id', authenticate, authorize('admin'), doctorController.deactivateDoctor);

/* ---------------------------------------------------------------------------
 * Doctor — everything below requires the doctor role
 * ------------------------------------------------------------------------- */

router.get('/me', authenticate, authorize('doctor'), doctorController.getMyProfile);
router.put('/me', authenticate, authorize('doctor'), doctorController.updateMyProfile);

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
