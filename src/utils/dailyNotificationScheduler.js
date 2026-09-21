import CycleSettings from '../models/CycleSettings.js';
import CycleLog from '../models/CycleLog.js';
import Notification from '../models/Notification.js';
import { computeCyclePredictions } from './cycle.js';
import { dateToDateKey, timingSafeEqualStrings, todayDateKey } from './apiHelpers.js';
import { sendResponse, sendError } from './sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from './logger.js';

// A few rotating variants so the daily nudge doesn't read as the exact same
// canned line every day.
const DAILY_NUDGE_MESSAGES = [
  {
    title: 'How are you feeling today? 💭',
    body: 'Take a moment to log your mood, flow, or symptoms — it only takes a few taps.',
  },
  {
    title: 'Got a minute for yourself?',
    body: 'Logging today helps Buddy give you better predictions and care.',
  },
  {
    title: 'Check in with yourself 🌸',
    body: "How's your body feeling today? Log it and watch your patterns build up over time.",
  },
];

/**
 * One daily-notification tick — for every user with cycle tracking set up,
 * checks three things against their own CycleSettings preferences (all
 * already user-configurable from the tracker's Cycle Settings sheet, but
 * previously never actually read by anything):
 *
 *  - `remindersEnabled` + `reminderDaysBefore` → a period_reminder exactly
 *    that many days before the predicted period start, once per cycle.
 *  - `ovulationReminder` / `fertilityReminder` → an ovulation_reminder the
 *    day the fertile window opens, once per cycle.
 *  - Also gated on `remindersEnabled` (not a separate preference, to avoid
 *    adding a new toggle for this): a once-daily "log today" nudge if the
 *    user hasn't logged anything yet today — this is the closest existing
 *    preference to "I want reminders from this app."
 *
 * Each Notification created here triggers its own push send automatically
 * (see models/Notification.js's post-save hook), so this file only needs to
 * decide *whether* to create one, not how to deliver it.
 *
 * Unlike checkinCallScheduler.js, this only needs day-level (not
 * minute-of-day) precision, so a tick once a day is enough — see
 * handleDailyNotificationTick below and the README's "Scheduled jobs"
 * section for exactly what to point an external scheduler at. "Today" is
 * evaluated in UTC (todayDateKey()), same convention as the rest of the
 * cycle-log data model — for users far from UTC this can land a reminder up
 * to ~12h off their actual local morning/evening, which is an accepted
 * trade-off for day-granularity reminders (unlike the check-in call's
 * chosen time-of-day, which does track a real per-user timezone offset).
 */
export const runDailyNotificationTick = async () => {
  const candidates = await CycleSettings.find({
    $or: [{ remindersEnabled: true }, { ovulationReminder: true }, { fertilityReminder: true }],
  });

  let periodRemindersSent = 0;
  let ovulationRemindersSent = 0;
  let dailyNudgesSent = 0;
  const todayKey = todayDateKey();

  for (const settings of candidates) {
    try {
      const logs = await CycleLog.find({ userId: settings.userId }).sort({ dateKey: 1 });
      const predictions = computeCyclePredictions(settings, logs);

      // Each guard below is claimed atomically (the guard field's own
      // `$ne` check lives in the same `findOneAndUpdate` filter as the
      // write that sets it), rather than checked in-memory and persisted
      // together via one `settings.save()` at the end — a retried/
      // concurrent tick invocation could otherwise read the same stale
      // guard value for two overlapping runs and create duplicate
      // notifications/pushes before either persisted it.
      if (
        settings.remindersEnabled &&
        predictions.nextPeriodDaysAway === (settings.reminderDaysBefore ?? 2)
      ) {
        const claimed = await CycleSettings.findOneAndUpdate(
          {
            userId: settings.userId,
            lastPeriodReminderCycleKey: { $ne: predictions.nextPeriodDateKey },
          },
          { $set: { lastPeriodReminderCycleKey: predictions.nextPeriodDateKey } },
        );
        if (claimed) {
          await Notification.create({
            userId: settings.userId,
            type: 'period_reminder',
            title: 'Your period is coming up',
            body: `Your period is expected around ${predictions.nextPeriodDate} — want to get ahead of it?`,
            data: { nextPeriodDateKey: predictions.nextPeriodDateKey },
          });
          periodRemindersSent += 1;
        }
      }

      // Fires the day the fertile window *opens* (a few days ahead of
      // ovulation itself), so there's still time to act on it, rather than
      // on ovulation day itself.
      if (
        (settings.ovulationReminder || settings.fertilityReminder) &&
        predictions.ovulationReliable &&
        todayKey === dateToDateKey(predictions.fertileWindowStartISO)
      ) {
        const claimed = await CycleSettings.findOneAndUpdate(
          {
            userId: settings.userId,
            lastOvulationReminderCycleKey: { $ne: predictions.ovulationDateKey },
          },
          { $set: { lastOvulationReminderCycleKey: predictions.ovulationDateKey } },
        );
        if (claimed) {
          await Notification.create({
            userId: settings.userId,
            type: 'ovulation_reminder',
            title: 'Your fertile window is starting',
            body: `Ovulation is expected around ${predictions.ovulationDate}.`,
            data: { ovulationDateKey: predictions.ovulationDateKey },
          });
          ovulationRemindersSent += 1;
        }
      }

      if (settings.remindersEnabled && !logs.some((log) => log.dateKey === todayKey)) {
        const claimed = await CycleSettings.findOneAndUpdate(
          { userId: settings.userId, lastDailyNudgeDateKey: { $ne: todayKey } },
          { $set: { lastDailyNudgeDateKey: todayKey } },
        );
        if (claimed) {
          const message =
            DAILY_NUDGE_MESSAGES[Math.floor(Math.random() * DAILY_NUDGE_MESSAGES.length)];
          await Notification.create({
            userId: settings.userId,
            type: 'system',
            title: message.title,
            body: message.body,
            data: { kind: 'daily_nudge' },
          });
          dailyNudgesSent += 1;
        }
      }
    } catch (error) {
      // One user's failure shouldn't stop the rest of this tick.
      logger.error('daily_notification_tick_error', {
        action: 'daily_notification_tick_error',
        userId: settings.userId,
        error: error.message,
      });
    }
  }

  return {
    candidates: candidates.length,
    periodRemindersSent,
    ovulationRemindersSent,
    dailyNudgesSent,
  };
};

/**
 * POST /api/notifications/daily-tick — the HTTP endpoint an external
 * scheduler (AWS EventBridge Scheduler, once a day) calls to run one tick.
 * Same shared-secret pattern as checkinCallScheduler.js's
 * handleSchedulerTick, but its own secret (NOTIFICATION_SCHEDULER_SECRET) so
 * the two can be rotated independently.
 */
export const handleDailyNotificationTick = async (req, res) => {
  const configuredSecret = process.env.NOTIFICATION_SCHEDULER_SECRET;
  const providedSecret = req.headers['x-scheduler-secret'];

  if (
    !configuredSecret ||
    !providedSecret ||
    !timingSafeEqualStrings(String(providedSecret), configuredSecret)
  ) {
    return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Invalid or missing scheduler secret');
  }

  try {
    const result = await runDailyNotificationTick();
    logger.info('daily_notification_tick', { action: 'daily_notification_tick', ...result });
    return sendResponse(res, HTTP_STATUS.OK, 'Daily notification tick complete', result);
  } catch (error) {
    logger.error('daily_notification_tick_failed', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Daily notification tick failed');
  }
};
