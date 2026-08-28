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

/**
 * @route   POST /api/voice-agent/checkin-call
 * @desc    Trigger an outbound Samvaad "call me now" cycle check-in call for
 *          the logged-in user
 * @access  Private
 */
router.post('/checkin-call', authenticate, voiceAgentController.triggerCheckinCall);

/**
 * @route   POST /api/voice-agent/checkin-call/webhook
 * @desc    Sarvam Instant Outbound's call-completion webhook (see
 *          samvaadClient.js's webhook_config) — public, no auth (Sarvam has
 *          no way to send our JWT); correlates back to a user purely via
 *          the webhook_config.metadata.userId echoed back in the payload.
 * @access  Public
 */
router.post('/checkin-call/webhook', voiceAgentController.checkinCallWebhook);

export default router;
