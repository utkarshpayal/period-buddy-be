import CycleSettings from '../models/CycleSettings.js';
import CycleLog from '../models/CycleLog.js';
import { computeCyclePredictions, addDays } from './cycle.js';
import { dateToDateKey, timingSafeEqualStrings } from './apiHelpers.js';
import { runCheckinCallForUser } from '../controllers/voiceAgentController.js';
import { isSamvaadConfigured } from './samvaadClient.js';
import { sendResponse, sendError } from './sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from './logger.js';
import { activeUserIdSet } from './accountStatus.js';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * One scheduler tick — finds users with a recurring check-in call enabled
 * (CycleSettings.checkinCall*, set via PUT /api/voice-agent/checkin-call/
 * schedule) whose local time-of-day matches checkinCallTime AND whose local
 * date matches (predicted period start + checkinCallDayOffset), then fires
 * their call via the same runCheckinCallForUser the manual "call me now"
 * endpoint uses. Recurs every cycle for free — nextPeriodDateKey is
 * re-derived fresh from live predictions each tick, so there's no separate
 * "next occurrence" state to maintain, just checkinCallLastFiredDateKey to
 * guard against firing twice in the same local day.
 *
 * Triggered externally, once a minute, by an AWS EventBridge Scheduler
 * calling POST /api/voice-agent/checkin-call/scheduler-tick (see
 * voiceAgentController.js's runSchedulerTick + voiceAgentRoutes.js) —
 * deliberately NOT an in-process timer (node-cron etc.), since that only
 * fires correctly on exactly one running instance; if this backend ever
 * scales to more than one process, an in-process timer would place the same
 * call multiple times. An external, single scheduled trigger avoids that.
 */
export const runCheckinCallSchedulerTick = async () => {
  if (!isSamvaadConfigured()) return { candidates: 0, fired: 0 }; // nothing to do until configured

  const allCandidates = await CycleSettings.find({
    checkinCallEnabled: true,
    checkinCallTime: { $regex: TIME_REGEX },
  });
  // Never phone a suspended or deleted account.
  const liveIds = await activeUserIdSet(allCandidates.map((settings) => settings.userId));
  const candidates = allCandidates.filter((settings) => liveIds.has(String(settings.userId)));

  let fired = 0;

  for (const settings of candidates) {
    try {
      const tzOffset = Number(settings.checkinCallTimezoneOffsetMinutes) || 0;
      const localNow = new Date(Date.now() - tzOffset * 60000);
      const localTime = localNow.toISOString().slice(11, 16); // 'HH:mm'
      if (localTime !== settings.checkinCallTime) continue;

      const localDateKey = dateToDateKey(localNow);
      if (settings.checkinCallLastFiredDateKey === localDateKey) continue; // already fired today

      const logs = await CycleLog.find({ userId: settings.userId }).sort({ dateKey: 1 });
      const predictions = computeCyclePredictions(settings, logs);
      const targetDate = addDays(
        new Date(predictions.nextPeriodDateISO),
        settings.checkinCallDayOffset || 0,
      );
      if (dateToDateKey(targetDate) !== localDateKey) continue; // not the scheduled day yet

      // Claim the "fired today" guard atomically, as part of the same
      // operation that decides whether to fire — this tick runs every
      // minute, and a slow outbound call spanning a minute boundary (or two
      // overlapping ticks) could otherwise both pass the plain in-memory
      // check above before either persisted the guard, placing the same
      // call twice. Only the request whose `findOneAndUpdate` actually
      // matches (guard wasn't already set to today) proceeds to call.
      const claimed = await CycleSettings.findOneAndUpdate(
        { userId: settings.userId, checkinCallLastFiredDateKey: { $ne: localDateKey } },
        { $set: { checkinCallLastFiredDateKey: localDateKey } },
      );
      if (!claimed) continue; // another concurrent tick already claimed today

      await runCheckinCallForUser(settings.userId);
      fired += 1;
    } catch (error) {
      // One user's failure (no phone, a transient Sarvam error, etc.)
      // shouldn't stop the rest of this tick from processing.
      logger.error('checkin_call_scheduler_tick_error', {
        action: 'checkin_call_scheduler_tick_error',
        userId: settings.userId,
        error: error.message,
      });
    }
  }

  return { candidates: candidates.length, fired };
};

/**
 * POST /api/voice-agent/checkin-call/scheduler-tick — the HTTP endpoint an
 * external scheduler (AWS EventBridge Scheduler) calls once a minute to run
 * one tick. Not a user-facing route — no user JWT applies here, so this
 * authenticates via a shared secret header instead
 * (CHECKIN_CALL_SCHEDULER_SECRET), checked with a constant-time compare so
 * response timing can't leak the secret. Deliberately fails closed: if the
 * secret isn't configured on the server, every request is rejected rather
 * than silently accepted.
 */
export const handleSchedulerTick = async (req, res) => {
  const configuredSecret = process.env.CHECKIN_CALL_SCHEDULER_SECRET;
  const providedSecret = req.headers['x-scheduler-secret'];

  if (
    !configuredSecret ||
    !providedSecret ||
    !timingSafeEqualStrings(String(providedSecret), configuredSecret)
  ) {
    return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Invalid or missing scheduler secret');
  }

  try {
    const result = await runCheckinCallSchedulerTick();
    logger.info('checkin_call_scheduler_tick', {
      action: 'checkin_call_scheduler_tick',
      ...result,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Scheduler tick complete', result);
  } catch (error) {
    logger.error('checkin_call_scheduler_tick_failed', { error: error.message });
    return sendError(res, HTTP_STATUS.INTERNAL_SERVER_ERROR, 'Scheduler tick failed');
  }
};
