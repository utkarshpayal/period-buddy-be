import AutoNotificationConfig from '../models/AutoNotificationConfig.js';
import CycleSettings from '../models/CycleSettings.js';
import Notification from '../models/Notification.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  AUTO_NOTIFICATIONS,
  AUTO_NOTIFICATION_KEYS,
  resolvePrefs,
} from '../utils/autoNotifications.js';
import { activeUserIdSet } from '../utils/accountStatus.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';

const STATS_DAYS = 7;

/**
 * GET /api/admin/notifications/automatic — every automatic notification
 * category with: on for everyone or not, how many people with cycle
 * tracking have it switched on, and how many went out (and were opened in
 * the app) in the last 7 days. Counts only, no one's details.
 */
export const getAutomaticNotifications = async (req, res, next) => {
  try {
    const since = new Date(Date.now() - STATS_DAYS * 24 * 3600 * 1000);
    const [config, settings, sentRows] = await Promise.all([
      AutoNotificationConfig.findOne({ key: 'global' }).lean(),
      CycleSettings.find({})
        .select(
          'userId remindersEnabled ovulationReminder fertilityReminder notificationPrefs pregnancyMode',
        )
        .lean(),
      Notification.aggregate([
        { $match: { createdAt: { $gte: since }, 'data.autoKey': { $in: AUTO_NOTIFICATION_KEYS } } },
        {
          $group: {
            _id: '$data.autoKey',
            sent: { $sum: 1 },
            read: { $sum: { $cond: ['$isRead', 1, 0] } },
          },
        },
      ]),
    ]);
    const live = await activeUserIdSet(settings.map((s) => s.userId));
    const people = settings.filter((s) => live.has(String(s.userId)));
    const disabled = new Set(config?.disabled || []);
    const sent = Object.fromEntries(sentRows.map((r) => [r._id, r]));
    const usersOn = Object.fromEntries(AUTO_NOTIFICATION_KEYS.map((k) => [k, 0]));
    for (const s of people) {
      const prefs = resolvePrefs(s);
      for (const k of AUTO_NOTIFICATION_KEYS) if (prefs[k]) usersOn[k] += 1;
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Automatic notifications', {
      users: people.length,
      pregnancyMode: people.filter((s) => s.pregnancyMode).length,
      statsDays: STATS_DAYS,
      updatedAt: config?.updatedAt ?? null,
      categories: AUTO_NOTIFICATIONS.map((c) => ({
        key: c.key,
        label: c.label,
        description: c.description,
        defaultOn: c.defaultOn,
        enabled: !disabled.has(c.key),
        usersOn: usersOn[c.key],
        sent: sent[c.key]?.sent ?? 0,
        read: sent[c.key]?.read ?? 0,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/notifications/automatic — body { key, enabled }. Turns one
 * category on or off for everyone. People's own switches are kept.
 */
export const setAutomaticNotification = async (req, res, next) => {
  try {
    const { key, enabled } = req.body || {};
    if (!AUTO_NOTIFICATION_KEYS.includes(key) || typeof enabled !== 'boolean') {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'key must be a known category and enabled a boolean',
      );
    }
    await AutoNotificationConfig.updateOne(
      { key: 'global' },
      { [enabled ? '$pull' : '$addToSet']: { disabled: key }, $set: { updatedBy: req.userId } },
      { upsert: true },
    );
    recordAudit({
      req,
      action: AUDIT_ACTIONS.AUTO_NOTIFICATION_UPDATED,
      resourceType: 'auto_notification',
      resourceId: key,
      metadata: { enabled },
    });
    return getAutomaticNotifications(req, res, next);
  } catch (error) {
    next(error);
  }
};
