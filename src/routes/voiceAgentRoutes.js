import express from 'express';
import * as voiceAgentController from '../controllers/voiceAgentController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { handleSchedulerTick } from '../utils/checkinCallScheduler.js';

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
// Gated behind 'voice_checkin_calls' via the global feature-route registry
// (config/subscriptionRouteRegistry.js), not inline here.
router.post('/checkin-call', authenticate, voiceAgentController.triggerCheckinCall);

/**
 * @route   GET /api/voice-agent/checkin-call/schedule
 * @desc    Read the logged-in user's recurring check-in call preference
 * @access  Private
 */
router.get('/checkin-call/schedule', authenticate, voiceAgentController.getCheckinCallSchedule);

/**
 * @route   GET /api/voice-agent/checkin-call/history
 * @desc    The logged-in user's recent check-in calls (outcome, duration,
 *          summary), newest first
 * @access  Private
 */
router.get('/checkin-call/history', authenticate, voiceAgentController.getCheckinCallHistory);

/**
 * @route   PUT /api/voice-agent/checkin-call/schedule
 * @desc    Save the logged-in user's recurring check-in call preference —
 *          fired automatically by utils/checkinCallScheduler.js
 * @access  Private
 */
// Also gated behind 'voice_checkin_calls' via the global registry.
router.put('/checkin-call/schedule', authenticate, voiceAgentController.saveCheckinCallSchedule);

/**
 * @route   POST /api/voice-agent/checkin-call/webhook
 * @desc    Sarvam Instant Outbound's call-completion webhook (see
 *          samvaadClient.js's webhook_config) — public, no auth (Sarvam has
 *          no way to send our JWT); correlates back to a user purely via
 *          the webhook_config.metadata.userId echoed back in the payload.
 * @access  Public
 */
router.post('/checkin-call/webhook', voiceAgentController.checkinCallWebhook);

/**
 * @route   POST /api/voice-agent/checkin-call/scheduler-tick
 * @desc    Runs one recurring-check-in-call scheduler tick — called once a
 *          minute by an external scheduler (AWS EventBridge Scheduler), not
 *          an in-process timer, so it fires correctly even if this backend
 *          scales to more than one instance. Not user-facing — no JWT
 *          applies; authenticated via a shared secret header instead (see
 *          checkinCallScheduler.js's handleSchedulerTick).
 * @access  Public (secret-protected)
 */
router.post('/checkin-call/scheduler-tick', handleSchedulerTick);

export default router;
