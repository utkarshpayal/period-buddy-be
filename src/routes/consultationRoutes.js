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
 * @route   POST /api/consultation/book
 * @desc    Book & pay for a consultation session
 * @access  Private
 */
router.post('/book', authenticate, consultationController.bookConsultation);

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
