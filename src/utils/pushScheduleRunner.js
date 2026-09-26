import PushSchedule from '../models/PushSchedule.js';
import PushBroadcast from '../models/PushBroadcast.js';
import { isFcmReady } from './fcm.js';
import { countAudience, enqueueBroadcast } from './pushBroadcastWorker.js';
import { nextOccurrence } from './pushSchedule.js';
import logger from './logger.js';

/**
 * Fires due PushSchedules (models/PushSchedule.js). Every minute it looks for
 * active schedules whose `nextRunAt` has passed, claims each occurrence by
 * moving `nextRunAt` on with a compare-and-set (so two instances, or a tick
 * that overlaps the previous one, never send the same occurrence twice), then
 * hands it to the broadcast worker as a normal PushBroadcast.
 *
 * An occurrence more than MISFIRE_GRACE_MS late (the server was down through
 * it) is skipped rather than sent: a "good morning" push at 9pm, or a week of
 * daily pushes all at once after an outage, is worse than a missed one.
 */

const TICK_MS = 60 * 1000;
const MISFIRE_GRACE_MS = 60 * 60 * 1000;
const DUE_BATCH = 50;

const fire = async (schedule) => {
  const id = schedule._id;
  if (!isFcmReady()) {
    await PushSchedule.updateOne(
      { _id: id },
      { $set: { lastError: 'Push notifications are not configured — this send was skipped' } },
    );
    return;
  }

  const counts = await countAudience(schedule.audience, schedule.userIds);
  if (counts.totalUsers === 0) {
    await PushSchedule.updateOne(
      { _id: id },
      { $set: { lastError: 'No active users matched the recipients — this send was skipped' } },
    );
    return;
  }

  const broadcast = await PushBroadcast.create({
    title: schedule.title,
    body: schedule.body,
    data: schedule.data,
    audience: schedule.audience,
    userIds: schedule.userIds,
    recipientPreview: schedule.recipientPreview,
    saveToInbox: schedule.saveToInbox,
    ...counts,
    scheduleId: id,
    createdBy: schedule.createdBy,
  });
  await PushSchedule.updateOne(
    { _id: id },
    { $set: { lastBroadcastId: broadcast._id, lastError: null } },
  );
  enqueueBroadcast(broadcast._id, schedule.audience);

  logger.info('push_schedule_fired', {
    action: 'push_schedule_fired',
    scheduleId: String(id),
    broadcastId: String(broadcast._id),
    run: schedule.runCount,
    ...counts,
  });
};

/** One pass over due schedules. Exported for tests / a manual tick. */
export const runPushScheduleTick = async (now = new Date()) => {
  const due = await PushSchedule.find({ status: 'active', nextRunAt: { $ne: null, $lte: now } })
    .sort({ nextRunAt: 1 })
    .limit(DUE_BATCH)
    .lean();

  let fired = 0;
  let skipped = 0;
  for (const schedule of due) {
    const late = now - schedule.nextRunAt > MISFIRE_GRACE_MS;
    const runCount = schedule.runCount + (late ? 0 : 1);
    // Count from `now`, not the missed slot, so an outage skips every
    // occurrence it covered in one go.
    const next = nextOccurrence({ ...schedule, runCount }, now);

    const claimed = await PushSchedule.findOneAndUpdate(
      { _id: schedule._id, status: 'active', nextRunAt: schedule.nextRunAt },
      {
        $set: {
          nextRunAt: next,
          status: next ? 'active' : 'completed',
          ...(late
            ? {
                lastError: `Skipped the send due ${schedule.nextRunAt.toISOString()} — the server was offline`,
              }
            : { lastRunAt: now }),
        },
        $inc: late ? { skippedCount: 1 } : { runCount: 1 },
      },
      { new: true, lean: true },
    );
    if (!claimed) continue; // another tick/instance got it, or it was paused/edited

    if (late) {
      skipped += 1;
      logger.warn('push_schedule_misfire_skipped', {
        action: 'push_schedule_misfire_skipped',
        scheduleId: String(schedule._id),
        dueAt: schedule.nextRunAt,
      });
      continue;
    }

    try {
      await fire(claimed);
      fired += 1;
    } catch (error) {
      await PushSchedule.updateOne(
        { _id: schedule._id },
        { $set: { lastError: error.message } },
      ).catch(() => {});
      logger.error('push_schedule_fire_failed', {
        action: 'push_schedule_fire_failed',
        scheduleId: String(schedule._id),
        error: error.message,
      });
    }
  }
  return { due: due.length, fired, skipped };
};

let tickHandle = null;
let ticking = false;

const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const result = await runPushScheduleTick();
    if (result.due > 0)
      logger.info('push_schedule_tick', { action: 'push_schedule_tick', ...result });
  } catch (error) {
    logger.error('push_schedule_tick_failed', {
      action: 'push_schedule_tick_failed',
      error: error.message,
    });
  } finally {
    ticking = false;
  }
};

/**
 * Started from index.js next to the broadcast worker. Always on (unlike
 * ENABLE_IN_PROCESS_SCHEDULER): the compare-and-set claim makes it safe to run
 * in more than one instance.
 */
export const startPushScheduler = () => {
  if (tickHandle) return;
  setTimeout(tick, 15 * 1000).unref();
  tickHandle = setInterval(tick, TICK_MS);
  tickHandle.unref();
};

export const stopPushScheduler = () => {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
};
