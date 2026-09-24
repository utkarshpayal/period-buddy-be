import express from 'express';
import * as screeningController from '../controllers/screeningController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/screening/questions
 * @desc    Get the static question set + disclaimer for a condition (?condition=pcos)
 * @access  Private
 */
router.get('/questions', authenticate, screeningController.getQuestions);

/**
 * @route   POST /api/screening/assess
 * @desc    Score answers for a condition, save the assessment, and return the result
 * @access  Private
 * @note    Gated behind 'symptom_checker' via the global feature-route
 *          registry (config/subscriptionRouteRegistry.js), not inline here.
 */
router.post('/assess', authenticate, screeningController.submitAssessment);

/**
 * @route   GET /api/screening/history
 * @desc    Get user's past screening assessments, newest first
 * @access  Private
 */
router.get('/history', authenticate, screeningController.getHistory);

export default router;
