import express from 'express';
import * as consultationController from '../controllers/consultationController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';
import { userRoleEnum } from '../enums/enums.js';
import * as videoCallController from '../controllers/videoCallController.js';
import {
  noopLimiter,
  rateLimitEnabled,
  videoAttendanceLimiter,
  videoJoinLimiter,
} from '../middleware/rateLimiters.js';

const router = express.Router();

// Booking and running a session is for app accounts only: a doctor or staff
// login can't book (or rate) a session, e.g. with their own profile.
const patient = [authenticate, authorize(userRoleEnum.USER, userRoleEnum.PARTNER)];
const videoLimiter = rateLimitEnabled ? videoJoinLimiter : noopLimiter;
const attendanceLimiter = rateLimitEnabled ? videoAttendanceLimiter : noopLimiter;

/**
 * @route   GET /api/consultation/doctors
 * @desc    List available doctors (optional ?search=)
 * @access  Private
 */
router.get('/doctors', authenticate, consultationController.getDoctors);

/**
 * @route   GET /api/consultation/doctors/:id/availability
 * @desc    Weekly availability for a doctor, grouped by day
 * @access  Private
 */
router.get('/doctors/:id/availability', authenticate, consultationController.getDoctorAvailability);

/**
 * @route   POST /api/consultation/order
 * @desc    Create a Cashfree order for a consultation session
 * @access  Private
 */
router.post('/order', ...patient, consultationController.createConsultationOrder);

/**
 * @route   POST /api/consultation/verify
 * @desc    Verify a completed Cashfree checkout and activate the session
 * @access  Private
 */
router.post('/verify', ...patient, consultationController.verifyConsultationPayment);

/**
 * @route   GET /api/consultation/my
 * @desc    Get all consultations for the current user (opt-in ?page=&limit= paging; pagination next to data)
 * @access  Private
 */
router.get('/my', ...patient, consultationController.getMyConsultations);

/**
 * @route   GET /api/consultation/:id/prescription
 * @desc    Printable prescription for one of the user's sessions ({ html, fileName, number })
 * @access  Private
 */
router.get('/:id/prescription', ...patient, consultationController.getPrescription);

/**
 * @route   GET /api/consultation/:id/messages
 * @desc    Get chat messages for a consultation
 * @access  Private
 */
router.get('/:id/messages', ...patient, consultationController.getMessages);

/**
 * @route   POST /api/consultation/:id/message
 * @desc    Send a message in a consultation chat
 * @access  Private
 */
router.post('/:id/message', ...patient, consultationController.sendMessage);

/**
 * @route   POST /api/consultation/:id/rating
 * @desc    Rate a completed session once (rating 1-5, optional comment up to 500 chars)
 * @access  Private (the patient)
 */
router.post('/:id/rating', ...patient, consultationController.rateConsultation);

/**
 * @route   PATCH /api/consultation/:id/cancel
 * @desc    Cancel a pending/paid consultation
 * @access  Private
 */
router.patch('/:id/cancel', ...patient, consultationController.cancelConsultation);

/**
 * @route   POST /api/consultation/:id/call/decline
 * @desc    Decline a ringing video call from the doctor
 * @access  Private (patient)
 */
router.post('/:id/call/decline', ...patient, consultationController.declineCall);

/**
 * @route   POST /api/consultation/:id/video/join
 * @desc    Short-lived token for this consultation's Jitsi room (booked patient, paid, inside the join window)
 * @access  Private (patient)
 */
router.post('/:id/video/join', ...patient, videoLimiter, videoCallController.joinAsPatient);

/**
 * @route   POST /api/consultation/:id/video/attendance
 * @desc    Informational joined/left report from the call screen ({ event }); never changes the session
 * @access  Private (patient)
 */
router.post(
  '/:id/video/attendance',
  ...patient,
  attendanceLimiter,
  videoCallController.reportPatientAttendance,
);

export default router;
