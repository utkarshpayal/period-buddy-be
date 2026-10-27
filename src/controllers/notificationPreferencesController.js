import CycleSettings from '../models/CycleSettings.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  AUTO_NOTIFICATIONS,
  DEFAULT_NOTIFICATION_TIME,
  prefsUpdate,
  resolvePrefs,
} from '../utils/autoNotifications.js';
import { loadDisabledCategories } from '../utils/dailyNotificationScheduler.js';
import { parseTimeOfDay } from '../utils/checkinCall.js';

const PREF_FIELDS =
  'remindersEnabled reminderDaysBefore ovulationReminder fertilityReminder pregnancyMode ' +
  'notificationPrefs notificationTime notificationTimezoneOffsetMinutes';

/** The phone's offset from X-Timezone-Offset (or the body), if valid. */
const clientOffset = (req) => {
  const raw = req.body?.timezoneOffsetMinutes ?? req.get?.('X-Timezone-Offset');
  const n = Number(raw);
  return raw !== undefined &&
    raw !== null &&
    raw !== '' &&
    Number.isInteger(n) &&
    Math.abs(n) <= 840
    ? n
    : null;
};

const buildResponse = async (userId) => {
  const [user, settings, disabled] = await Promise.all([
    User.findById(userId).select('notificationsEnabled').lean(),
    CycleSettings.findOne({ userId }).select(PREF_FIELDS).lean(),
    loadDisabledCategories(),
  ]);
  const prefs = resolvePrefs(settings || {});
  return {
    push: user?.notificationsEnabled !== false,
    cycleSetUp: Boolean(settings),
    pregnancyMode: Boolean(settings?.pregnancyMode),
    time: settings?.notificationTime || DEFAULT_NOTIFICATION_TIME,
    reminderDaysBefore: settings?.reminderDaysBefore ?? 2,
    categories: AUTO_NOTIFICATIONS.map((c) => ({
      key: c.key,
      label: c.label,
      description: c.description,
      enabled: prefs[c.key],
      available: !disabled.has(c.key),
      pausedInPregnancy: c.pausedInPregnancy,
    })),
  };
};

/** GET /api/notifications/preferences */
export const getNotificationPreferences = async (req, res, next) => {
  try {
    // Keep the send time in the phone's own timezone.
    const offset = clientOffset(req);
    if (offset !== null) {
      await CycleSettings.updateOne(
        { userId: req.userId, notificationTimezoneOffsetMinutes: { $ne: offset } },
        { $set: { notificationTimezoneOffsetMinutes: offset } },
      );
    }
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Notification preferences',
      await buildResponse(req.userId),
    );
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/notifications/preferences
 * Body (all optional): { push: boolean, time: 'HH:mm', reminderDaysBefore: 0-10,
 * categories: { [key]: boolean }, timezoneOffsetMinutes }
 */
export const updateNotificationPreferences = async (req, res, next) => {
  try {
    const { push, time, reminderDaysBefore, categories } = req.body || {};
    if (push !== undefined && typeof push !== 'boolean') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'push must be true or false');
    }
    if (time !== undefined && parseTimeOfDay(time) === null) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'time must be HH:mm');
    }
    if (
      reminderDaysBefore !== undefined &&
      (!Number.isInteger(reminderDaysBefore) || reminderDaysBefore < 0 || reminderDaysBefore > 10)
    ) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'reminderDaysBefore must be between 0 and 10');
    }
    if (categories !== undefined && (typeof categories !== 'object' || Array.isArray(categories))) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'categories must be an object');
    }

    const $set = prefsUpdate(categories || {});
    if (time !== undefined) $set.notificationTime = time;
    if (reminderDaysBefore !== undefined) $set.reminderDaysBefore = reminderDaysBefore;
    const offset = clientOffset(req);
    if (offset !== null) $set.notificationTimezoneOffsetMinutes = offset;

    const cycleChanges = Object.keys($set).some((k) => k !== 'notificationTimezoneOffsetMinutes');
    if (cycleChanges) {
      const result = await CycleSettings.updateOne(
        { userId: req.userId },
        { $set },
        { runValidators: true },
      );
      if (!result.matchedCount) {
        return sendError(res, HTTP_STATUS.CONFLICT, 'Set up your cycle first to choose reminders');
      }
    } else if (offset !== null) {
      await CycleSettings.updateOne({ userId: req.userId }, { $set });
    }
    if (push !== undefined) {
      await User.updateOne({ _id: req.userId }, { $set: { notificationsEnabled: push } });
    }
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Notification preferences saved',
      await buildResponse(req.userId),
    );
  } catch (error) {
    next(error);
  }
};
