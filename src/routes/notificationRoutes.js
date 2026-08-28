import express from 'express';
import { handleDailyNotificationTick } from '../utils/dailyNotificationScheduler.js';

const router = express.Router();

// The in-app notification list itself (GET /list, PATCH /:id/read) still
// lives under /api/partner (see partnerController.js/partnerRoutes.js,
// consumed by the frontend as `partnerApi.getNotifications()` — it started
// as a partner-connection feature and was never moved). This file is just
// for the scheduled-job endpoint below; a fuller /api/notifications surface
// can move here later without breaking the existing one.

/**
 * @route   POST /api/notifications/daily-tick
 * @desc    Runs one daily-notification tick — period/ovulation reminders and
 *          the daily "log today" nudge, all derived from preferences the
 *          user already sets in Cycle Settings (see
 *          dailyNotificationScheduler.js). Called once a day by an external
 *          scheduler (same AWS EventBridge Scheduler pattern as the
 *          check-in call tick — see README's "Scheduled jobs" section), not
 *          an in-process timer (see checkinCallScheduler.js for why).
 * @access  Public (secret-protected via X-Scheduler-Secret)
 */
router.post('/daily-tick', handleDailyNotificationTick);

export default router;
