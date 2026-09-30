import User from '../models/User.js';
import Notification from '../models/Notification.js';
import QaChatSession from '../models/QaChatSession.js';
import DocumentChatMessage from '../models/DocumentChatMessage.js';
import AuditLog from '../models/AuditLog.js';
import FeatureUsage from '../models/FeatureUsage.js';
import logger from './logger.js';

/**
 * Deletes data once it's older than we keep it (docs/SECURITY.md,
 * "Retention"). The periods are in the privacy policy; change both together.
 *
 * - Notifications: NOTIFICATION_RETENTION_DAYS (90).
 * - Nura AI and document chats: the period each person picks on the app's
 *   privacy screen (User.privacySettings.aiChatRetentionDays, 0 = keep).
 * - Audit logs: AUDIT_LOG_RETENTION_DAYS (730).
 * - Feature usage counts: USAGE_RETENTION_DAYS (400). Per-device usage rows
 *   already expire after 100 days (models/FeatureUsageDevice.js).
 *
 * A period of 0 turns that deletion off. Runs every 6 hours; safe with more
 * than one instance, since deleting twice deletes nothing the second time.
 */

const TICK_MS = 6 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

const days = (name, fallback) => {
  const raw = process.env[name];
  const n = raw === undefined || raw === '' ? fallback : Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

export const retentionDays = () => ({
  notifications: days('NOTIFICATION_RETENTION_DAYS', 90),
  auditLogs: days('AUDIT_LOG_RETENTION_DAYS', 730),
  usage: days('USAGE_RETENTION_DAYS', 400),
});

/** The date before which rows are deleted, or null when `keepDays` is 0. */
export const cutoffFor = (keepDays, now = new Date()) =>
  keepDays > 0 ? new Date(now.getTime() - keepDays * DAY_MS) : null;

/** "YYYY-MM-DD" (UTC) of a cutoff, for collections keyed by day string. */
export const dayKeyOf = (date) => date.toISOString().slice(0, 10);

let tickHandle = null;
let ticking = false;

/** Each person's AI chats past the period they picked. */
const purgeAiChats = async (now) => {
  let sessions = 0;
  let messages = 0;
  const cursor = User.find({ 'privacySettings.aiChatRetentionDays': { $gt: 0 } })
    .select('_id privacySettings.aiChatRetentionDays')
    .lean()
    .cursor();
  for await (const user of cursor) {
    const cutoff = cutoffFor(user.privacySettings.aiChatRetentionDays, now);
    const [a, b] = await Promise.all([
      QaChatSession.deleteMany({ userId: user._id, lastMessageAt: { $lt: cutoff } }),
      DocumentChatMessage.deleteMany({ userId: user._id, createdAt: { $lt: cutoff } }),
    ]);
    sessions += a.deletedCount || 0;
    messages += b.deletedCount || 0;
  }
  return { sessions, messages };
};

export const runRetention = async (now = new Date()) => {
  const keep = retentionDays();
  const result = {};
  const notificationCutoff = cutoffFor(keep.notifications, now);
  if (notificationCutoff) {
    const r = await Notification.deleteMany({ createdAt: { $lt: notificationCutoff } });
    result.notifications = r.deletedCount || 0;
  }
  const auditCutoff = cutoffFor(keep.auditLogs, now);
  if (auditCutoff) {
    const r = await AuditLog.deleteMany({ createdAt: { $lt: auditCutoff } });
    result.auditLogs = r.deletedCount || 0;
  }
  const usageCutoff = cutoffFor(keep.usage, now);
  if (usageCutoff) {
    const r = await FeatureUsage.deleteMany({ day: { $lt: dayKeyOf(usageCutoff) } });
    result.usage = r.deletedCount || 0;
  }
  const chats = await purgeAiChats(now);
  result.aiChatSessions = chats.sessions;
  result.documentChatMessages = chats.messages;
  return result;
};

const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const result = await runRetention();
    if (Object.values(result).some(Boolean)) {
      logger.info('retention_purged', { action: 'retention_purged', ...result });
    }
  } catch (error) {
    logger.error('retention_tick_failed', {
      action: 'retention_tick_failed',
      error: error.message,
    });
  } finally {
    ticking = false;
  }
};

/** Started from index.js with the other schedulers. */
export const startRetentionRunner = () => {
  if (tickHandle) return;
  setTimeout(tick, 5 * 60 * 1000).unref();
  tickHandle = setInterval(tick, TICK_MS);
  tickHandle.unref();
};

export const stopRetentionRunner = () => {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
};
