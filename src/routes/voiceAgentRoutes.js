import express from 'express';
import * as voiceAgentController from '../controllers/voiceAgentController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   POST /api/voice-agent/converse
 * @desc    One turn of the voice agent conversation — answers questions, or
 *          guides/executes an action (e.g. logging today's cycle entry)
 * @access  Private
 */
router.post('/converse', authenticate, voiceAgentController.converse);

export default router;
