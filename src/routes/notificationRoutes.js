import express from 'express';
import { handleDailyNotificationTick } from '../utils/dailyNotificationScheduler.js';
import { authenticate } from '../middleware/authMiddleware.js';
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from '../controllers/notificationPreferencesController.js';

const router = express.Router();

// The in-app notification list itself (GET /list, PATCH /:id/read) still
// lives under /api/partner (see partnerController.js/partnerRoutes.js,
// consumed by the frontend as `partnerApi.getNotifications()` — it started
// as a partner-connection feature and was never moved). This file is just
// for the scheduled-job endpoint below; a fuller /api/notifications surface
// can move here later without breaking the existing one.

/**
 * @route   POST /api/notifications/daily-tick
 * @desc    Runs one automatic-notification tick (utils/autoNotifications.js):
 *          each person gets what's due at their own local time. Call it
 *          hourly from an external scheduler when ENABLE_IN_PROCESS_SCHEDULER
 *          is off (see docs/PUSH_AND_SCHEDULED_JOBS.md).
 * @access  Public (secret-protected via X-Scheduler-Secret)
 */
router.post('/daily-tick', handleDailyNotificationTick);

/**
 * @route   GET /api/notifications/preferences
 * @desc    The person's automatic notification settings: push on/off, send
 *          time, days-before for the period reminder, and each category
 *          (utils/autoNotifications.js) with whether it's on and whether an
 *          admin has turned it off for everyone (available: false).
 * @access  Private
 */
router.get('/preferences', authenticate, getNotificationPreferences);

/**
 * @route   PUT /api/notifications/preferences
 * @desc    Change any of: push (boolean), time ('HH:mm'), reminderDaysBefore
 *          (0-10), categories ({ key: boolean }). Returns the same shape as GET.
 *          409 if a cycle setting is changed before cycle tracking is set up.
 * @access  Private
 */
router.put('/preferences', authenticate, updateNotificationPreferences);

export default router;
