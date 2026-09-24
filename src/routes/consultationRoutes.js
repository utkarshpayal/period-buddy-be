import express from 'express';
import * as consultationController from '../controllers/consultationController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

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
router.post('/order', authenticate, consultationController.createConsultationOrder);

/**
 * @route   POST /api/consultation/verify
 * @desc    Verify a completed Cashfree checkout and activate the session
 * @access  Private
 */
router.post('/verify', authenticate, consultationController.verifyConsultationPayment);

/**
 * @route   GET /api/consultation/my
 * @desc    Get all consultations for the current user
 * @access  Private
 */
router.get('/my', authenticate, consultationController.getMyConsultations);

/**
 * @route   GET /api/consultation/:id/messages
 * @desc    Get chat messages for a consultation
 * @access  Private
 */
router.get('/:id/messages', authenticate, consultationController.getMessages);

/**
 * @route   POST /api/consultation/:id/message
 * @desc    Send a message in a consultation chat
 * @access  Private
 */
router.post('/:id/message', authenticate, consultationController.sendMessage);

/**
 * @route   PATCH /api/consultation/:id/complete
 * @desc    Mark a consultation as completed
 * @access  Private
 */
router.patch('/:id/complete', authenticate, consultationController.completeConsultation);

/**
 * @route   PATCH /api/consultation/:id/cancel
 * @desc    Cancel a pending/paid consultation
 * @access  Private
 */
router.patch('/:id/cancel', authenticate, consultationController.cancelConsultation);

export default router;
