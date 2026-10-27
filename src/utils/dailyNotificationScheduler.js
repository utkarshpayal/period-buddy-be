import CycleSettings from '../models/CycleSettings.js';
import Notification from '../models/Notification.js';
import { computeCyclePredictions } from './cycle.js';
import { loadPredictionLogs } from './predictionLogs.js';
import { dateFromDateKey, timingSafeEqualStrings } from './apiHelpers.js';
import AutoNotificationConfig from '../models/AutoNotificationConfig.js';
import { localClock, parseTimeOfDay } from './checkinCall.js';
import {
  AUTO_NOTIFICATION_KEYS,
  DEFAULT_NOTIFICATION_TIME,
  MAX_PER_DAY,
  QUIET_AFTER_MINUTES,
  planNotifications,
  resolvePrefs,
} from './autoNotifications.js';
import { sendResponse, sendError } from './sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from './logger.js';
import { activeUserIdSet } from './accountStatus.js';
import { completeOverdueConsultations } from './consultationLifecycle.js';

/**
 * One automatic-notification tick. Runs hourly (utils/inProcessScheduler.js,
 * or an external scheduler on POST /api/notifications/daily-tick). For each
 * person whose local time has reached their notification time (default
 * 9:00, never after 10 PM), it works out what's due on *their* local today
 * (utils/autoNotifications.js#planNotifications: period coming / due / late,
 * fertile window and ovulation, phase tips, their usual symptoms, health
 * alerts, the daily log reminder) and sends at most two.
 *
 * Every item is claimed atomically before it's created (its category's
 * guard in CycleSettings.notificationGuards, in the same findOneAndUpdate
 * filter as the write), so overlapping or repeated ticks can't send it
 * twice. Each Notification sends its own push (models/Notification.js).
 * Categories an admin turned off (AutoNotificationConfig) go to nobody.
 */
const SETTINGS_FIELDS =
  'userId lastPeriodStartDate cycleLength periodLength pregnancyMode remindersEnabled ' +
  'reminderDaysBefore ovulationReminder fertilityReminder notificationPrefs notificationTime ' +
  'notificationTimezoneOffsetMinutes checkinCallTimezoneOffsetMinutes notificationGuards ' +
  'notificationDayKey notificationsSentToday lastPeriodReminderCycleKey ' +
  'lastOvulationReminderCycleKey lastDailyNudgeDateKey';

// Users processed concurrently per batch: each one is a log read plus a few
// guarded writes, so a small batch keeps the pool free for requests.
const USER_BATCH_SIZE = 10;

/** Categories an admin has turned off for everyone. */
export const loadDisabledCategories = async () => {
  const config = await AutoNotificationConfig.findOne({ key: 'global' }).lean();
  return new Set(config?.disabled || []);
};

/**
 * This person's guards, filled in from the fields the reminders used before
 * per-category guards existed, so nothing already sent this cycle repeats.
 */
const guardsFor = (settings) => {
  const guards = Object.fromEntries(settings.notificationGuards || []);
  if (!guards.period_upcoming && settings.lastPeriodReminderCycleKey) {
    guards.period_upcoming = settings.lastPeriodReminderCycleKey;
  }
  if (!guards.fertile_window && settings.lastOvulationReminderCycleKey) {
    guards.fertile_window = `${settings.lastOvulationReminderCycleKey}:start`;
  }
  if (!guards.daily_log && settings.lastDailyNudgeDateKey) {
    guards.daily_log = settings.lastDailyNudgeDateKey;
  }
  return guards;
};

export const runDailyNotificationTick = async (now = new Date()) => {
  const disabled = await loadDisabledCategories();
  const allSettings = await CycleSettings.find({}).select(SETTINGS_FIELDS);
  // Suspended/deleted accounts get no reminders (or inbox rows).
  const liveIds = await activeUserIdSet(allSettings.map((settings) => settings.userId));

  const sent = Object.fromEntries(AUTO_NOTIFICATION_KEYS.map((key) => [key, 0]));
  let due = 0;

  const processUser = async (settings) => {
    try {
      const clock = localClock(
        now,
        settings.notificationTimezoneOffsetMinutes ?? settings.checkinCallTimezoneOffsetMinutes,
      );
      const sendAt = parseTimeOfDay(settings.notificationTime || DEFAULT_NOTIFICATION_TIME);
      if (clock.minutes < sendAt || clock.minutes >= QUIET_AFTER_MINUTES) return;
      const todayKey = clock.dateKey;
      const sentToday =
        settings.notificationDayKey === todayKey ? settings.notificationsSentToday || 0 : 0;
      if (sentToday >= MAX_PER_DAY) return;

      const logs = await loadPredictionLogs(settings.userId);
      const predictions = computeCyclePredictions(settings, logs, {
        today: dateFromDateKey(todayKey),
      });
      const plan = planNotifications({
        predictions,
        logs,
        todayKey,
        prefs: resolvePrefs(settings),
        reminderDaysBefore: settings.reminderDaysBefore ?? 2,
        pregnancyMode: Boolean(settings.pregnancyMode),
        disabled,
        guards: guardsFor(settings),
        sentToday,
      });
      if (!plan.length) return;
      due += 1;

      // A new local day starts the daily count again.
      if (settings.notificationDayKey !== todayKey) {
        await CycleSettings.updateOne(
          { userId: settings.userId, notificationDayKey: { $ne: todayKey } },
          { $set: { notificationDayKey: todayKey, notificationsSentToday: 0 } },
        );
      }
      for (const item of plan) {
        const guardPath = `notificationGuards.${item.key}`;
        const claimed = await CycleSettings.findOneAndUpdate(
          {
            userId: settings.userId,
            [guardPath]: { $ne: item.guard },
            notificationsSentToday: { $lt: MAX_PER_DAY },
          },
          { $set: { [guardPath]: item.guard }, $inc: { notificationsSentToday: 1 } },
        );
        if (!claimed) continue;
        await Notification.create({
          userId: settings.userId,
          type: item.type,
          title: item.title,
          body: item.body,
          data: { ...item.data, autoKey: item.key },
        });
        sent[item.key] += 1;
      }
    } catch (error) {
      // One user's failure shouldn't stop the rest of this tick.
      logger.error('daily_notification_tick_error', {
        action: 'daily_notification_tick_error',
        userId: settings.userId,
        error: error.message,
      });
    }
  };

  const candidates = allSettings.filter((settings) => liveIds.has(String(settings.userId)));
  for (let i = 0; i < candidates.length; i += USER_BATCH_SIZE) {
    await Promise.all(candidates.slice(i, i + USER_BATCH_SIZE).map(processUser));
  }

  return { candidates: candidates.length, usersNotified: due, sent };
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
    // An external scheduler only hits this endpoint, so it also closes
    // consultations nobody marked completed (see consultationLifecycle.js).
    try {
      result.consultations = await completeOverdueConsultations();
    } catch (error) {
      logger.error('consultation_auto_complete_tick_failed', { error: error.message });
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Daily notification tick complete', result);
  } catch (error) {
    logger.error('daily_notification_tick_failed', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Daily notification tick failed');
  }
};
