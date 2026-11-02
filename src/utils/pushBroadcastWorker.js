import User from '../models/User.js';
import Notification from '../models/Notification.js';
import PushBroadcast from '../models/PushBroadcast.js';
import { sendPushBatch, FCM_MAX_BATCH_SIZE } from './fcm.js';
import { HAS_PUSH_TOKEN, pruneDeadTokens, pushTokensOf } from './pushTokens.js';
import { parsePositiveInt } from './apiHelpers.js';
import { hidesNotificationDetails, pushFor } from './privacy.js';
import logger from './logger.js';

/**
 * Background worker for admin push broadcasts (see models/PushBroadcast.js).
 *
 * Why batches: loading every user + token into memory and firing one FCM call
 * per user doesn't survive a large user base (memory, FCM quota, request
 * timeouts). Instead the worker pages through users by _id (cursor-based, so
 * it stays fast at any offset), sends each page with one FCM sendEach() call
 * (≤500 tokens), persists progress, and pauses briefly before the next page.
 *
 * Delivery is at-least-once: if the process dies after a batch is sent but
 * before its cursor is saved, that one batch is re-sent on resume.
 *
 * Runs in-process (fire-and-forget after the admin's request returns 202).
 * A lease on the broadcast doc prevents two instances working the same job,
 * and resumePendingBroadcasts() on startup picks up anything a crashed or
 * redeployed instance left behind.
 */

const BATCH_SIZE = parsePositiveInt(process.env.PUSH_BROADCAST_BATCH_SIZE, FCM_MAX_BATCH_SIZE, {
  min: 1,
  max: FCM_MAX_BATCH_SIZE,
});
const BATCH_DELAY_MS = parsePositiveInt(process.env.PUSH_BROADCAST_BATCH_DELAY_MS, 250, {
  min: 0,
  max: 60_000,
});
const LEASE_MS = 2 * 60 * 1000; // renewed every batch; expiry = worker presumed dead
const SEND_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Mongo filter for the users a broadcast targets. Suspended/deleted accounts
 * are always excluded, even when hand-picked.
 */
export const buildAudienceFilter = (audience, userIds) => {
  const filter = { isActive: true, deletedAt: null };
  if (audience === 'selected') filter._id = { $in: userIds || [] };
  else if (audience && audience !== 'all') filter.role = audience;
  return filter;
};

/** How many users an audience reaches, and how many of them can get a device push. */
export const countAudience = async (audience, userIds) => {
  const filter = buildAudienceFilter(audience, userIds);
  const [totalUsers, totalWithToken] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments({
      $and: [filter, HAS_PUSH_TOKEN, { notificationsEnabled: { $ne: false } }],
    }),
  ]);
  return { totalUsers, totalWithToken };
};

/**
 * Splits a page of users into the device tokens that get the real push and
 * the ones that get the neutral text ("Hide notification details", on by
 * default). Users who turned notifications off get no push. Deduped: one
 * device can be registered on multiple accounts, and if any of them hides
 * details the device gets the neutral text.
 */
export const splitTokensByPrivacy = (users) => {
  const open = new Set();
  const hidden = new Set();
  for (const u of users) {
    if (u.notificationsEnabled === false) continue;
    const target = hidesNotificationDetails(u) ? hidden : open;
    for (const token of pushTokensOf(u)) target.add(token);
  }
  for (const token of hidden) open.delete(token);
  return { open: [...open], hidden: [...hidden] };
};

const sendWithRetry = async (tokens, payload, broadcastId) => {
  let lastError;
  for (let attempt = 1; attempt <= SEND_RETRIES; attempt += 1) {
    try {
      return await sendPushBatch(tokens, payload);
    } catch (error) {
      lastError = error;
      logger.warn('push_broadcast_batch_retry', {
        action: 'push_broadcast_batch_retry',
        broadcastId: String(broadcastId),
        attempt,
        error: error.message,
      });
      if (attempt < SEND_RETRIES) await sleep(1000 * 2 ** (attempt - 1));
    }
  }
  throw lastError;
};

const finish = (id, status, extra = {}) =>
  PushBroadcast.updateOne(
    { _id: id },
    { $set: { status, leaseUntil: null, completedAt: new Date(), ...extra } },
  );

const processBroadcast = async (id) => {
  const now = new Date();
  // Atomically claim the job; fails if another worker holds a live lease or
  // it's already finished/cancelled.
  let broadcast = await PushBroadcast.findOneAndUpdate(
    {
      _id: id,
      status: { $in: ['queued', 'running'] },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }],
    },
    {
      $set: { status: 'running', leaseUntil: new Date(Date.now() + LEASE_MS), lastError: null },
      $inc: { attempts: 1 },
    },
    { new: true },
  );
  if (!broadcast) return;

  if (!broadcast.startedAt) {
    await PushBroadcast.updateOne({ _id: id }, { $set: { startedAt: now } });
  }

  logger.info('push_broadcast_started', {
    action: 'push_broadcast_started',
    broadcastId: String(id),
    audience: broadcast.audience,
    resumeFrom: broadcast.cursor ? String(broadcast.cursor) : null,
  });

  const filter = buildAudienceFilter(broadcast.audience, broadcast.userIds);
  const payload = {
    title: broadcast.title,
    body: broadcast.body,
    data: { type: 'system', broadcastId: String(id), ...(broadcast.data || {}) },
  };

  try {
    for (;;) {
      if (broadcast.cancelRequested) {
        await finish(id, 'cancelled');
        logger.info('push_broadcast_cancelled', {
          action: 'push_broadcast_cancelled',
          broadcastId: String(id),
        });
        return;
      }

      const users = await User.find({
        ...filter,
        ...(broadcast.cursor && { _id: { ...filter._id, $gt: broadcast.cursor } }),
      })
        .sort({ _id: 1 })
        .limit(BATCH_SIZE)
        .select('_id notificationToken webPushTokens notificationsEnabled privacySettings')
        .lean();

      if (users.length === 0) {
        await finish(id, 'completed');
        logger.info('push_broadcast_completed', {
          action: 'push_broadcast_completed',
          broadcastId: String(id),
          sent: broadcast.sentCount,
          failed: broadcast.failedCount,
          invalidTokens: broadcast.invalidTokenCount,
        });
        return;
      }

      if (broadcast.saveToInbox) {
        // insertMany skips Notification's post('save') push hook, so this
        // writes the inbox rows without double-sending the push.
        await Notification.insertMany(
          users.map((u) => ({
            userId: u._id,
            type: 'system',
            title: broadcast.title,
            body: broadcast.body,
            data: payload.data,
            sentAt: new Date(),
          })),
          { ordered: false },
        );
      }

      // Users who turned notifications off in the app still get the inbox row
      // above, just no device push. Those who hide notification details get
      // the neutral text; the inbox row keeps the real one.
      const { open, hidden } = splitTokensByPrivacy(users);
      const result = { successCount: 0, failureCount: 0, deadTokens: [] };
      for (const [tokens, message] of [
        [open, payload],
        [hidden, pushFor(null, payload)],
      ]) {
        // A user can have a phone plus browsers, so a page of users can be
        // more than one FCM call's worth of tokens.
        for (let i = 0; i < tokens.length; i += FCM_MAX_BATCH_SIZE) {
          const sent = await sendWithRetry(tokens.slice(i, i + FCM_MAX_BATCH_SIZE), message, id);
          result.successCount += sent.successCount;
          result.failureCount += sent.failureCount;
          result.deadTokens.push(...sent.deadTokens);
        }
      }

      if (result.deadTokens.length > 0) {
        await pruneDeadTokens(result.deadTokens);
      }

      broadcast = await PushBroadcast.findOneAndUpdate(
        { _id: id },
        {
          $set: {
            cursor: users[users.length - 1]._id,
            leaseUntil: new Date(Date.now() + LEASE_MS),
          },
          $inc: {
            processedUsers: users.length,
            sentCount: result.successCount,
            failedCount: result.failureCount,
            invalidTokenCount: result.deadTokens.length,
            inboxCount: broadcast.saveToInbox ? users.length : 0,
            batchesCompleted: 1,
          },
        },
        { new: true },
      );

      if (BATCH_DELAY_MS > 0) await sleep(BATCH_DELAY_MS);
    }
  } catch (error) {
    // Cursor is preserved, so an admin "retry" resumes from the failed batch.
    await finish(id, 'failed', { lastError: error.message });
    logger.error('push_broadcast_failed', {
      action: 'push_broadcast_failed',
      broadcastId: String(id),
      error: error.message,
    });
  }
};

// Two lanes, each running one broadcast at a time: 'bulk' (audience-wide
// sends, so two big blasts never compete for FCM quota) and 'direct'
// (hand-picked users, so messaging a few people never waits behind a
// broadcast to the whole user base).
const lanes = {
  bulk: { queue: [], draining: false },
  direct: { queue: [], draining: false },
};
const queuedIds = new Set();

export const laneFor = (audience) => (audience === 'selected' ? 'direct' : 'bulk');

const drain = async (lane) => {
  if (lane.draining) return;
  lane.draining = true;
  try {
    while (lane.queue.length > 0) {
      const id = lane.queue.shift();
      try {
        await processBroadcast(id);
      } catch (error) {
        logger.error('push_broadcast_worker_error', {
          action: 'push_broadcast_worker_error',
          broadcastId: id,
          error: error.message,
        });
      } finally {
        queuedIds.delete(id);
      }
    }
  } finally {
    lane.draining = false;
  }
};

/** Schedule a broadcast for background processing. Returns immediately. */
export const enqueueBroadcast = (broadcastId, audience) => {
  const id = String(broadcastId);
  if (queuedIds.has(id)) return;
  queuedIds.add(id);
  const lane = lanes[laneFor(audience)];
  lane.queue.push(id);
  drain(lane);
};

/**
 * Called once on startup: re-queues broadcasts left queued, or running with an
 * expired lease (the previous process died mid-send).
 */
export const resumePendingBroadcasts = async () => {
  try {
    const pending = await PushBroadcast.find({
      status: { $in: ['queued', 'running'] },
      $or: [{ leaseUntil: null }, { leaseUntil: { $lt: new Date() } }],
    })
      .sort({ createdAt: 1 })
      .select('_id audience')
      .lean();

    pending.forEach((b) => enqueueBroadcast(b._id, b.audience));
    if (pending.length > 0) {
      logger.info('push_broadcast_resumed', {
        action: 'push_broadcast_resumed',
        count: pending.length,
      });
    }
  } catch (error) {
    logger.error('push_broadcast_resume_failed', {
      action: 'push_broadcast_resume_failed',
      error: error.message,
    });
  }
};

const SWEEP_INTERVAL_MS = 5 * 60 * 1000;
let sweepHandle = null;

/**
 * Resume on startup, then keep sweeping so a job whose lease was still live
 * at boot (quick restart) or that another instance abandoned is picked up
 * once its lease expires.
 */
export const startBroadcastWorker = () => {
  if (sweepHandle) return;
  resumePendingBroadcasts();
  sweepHandle = setInterval(resumePendingBroadcasts, SWEEP_INTERVAL_MS);
  sweepHandle.unref();
};

export const stopBroadcastWorker = () => {
  if (sweepHandle) clearInterval(sweepHandle);
  sweepHandle = null;
};
