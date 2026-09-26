import CycleSettings from '../models/CycleSettings.js';
import CycleLog from '../models/CycleLog.js';
import CheckinCall from '../models/CheckinCall.js';
import { computeCyclePredictions } from './cycle.js';
import { dateFromDateKey, timingSafeEqualStrings } from './apiHelpers.js';
import { placeCheckinCall } from '../controllers/voiceAgentController.js';
import { isSamvaadConfigured } from './samvaadClient.js';
import { sendResponse, sendError } from './sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from './logger.js';
import { activeUserIdSet } from './accountStatus.js';
import { localClock, parseTimeOfDay, planScheduledAttempt, resolveCallDay } from './checkinCall.js';

const TIME_REGEX = /^([01]\d|2[0-3]):[0-5]\d$/;

// Mongo duplicate-key: another tick already claimed this attempt.
const isDuplicateKey = (error) => error?.code === 11000;

/**
 * One scheduler tick. For every user with a recurring check-in call
 * enabled (CycleSettings.checkinCall*, set via PUT /api/voice-agent/
 * checkin-call/schedule):
 *
 * 1. Is today (the user's local date) a call day? 'period_daily' = each day
 *    of the period, 'once' = period start + dayOffset (resolveCallDay).
 *    Predictions are computed for that local date, so a period starting
 *    today counts as day 1.
 * 2. Has this cycle already had periodLength answered calls ('once': one)?
 * 3. Is an attempt due (planScheduledAttempt)? The day's first call goes out
 *    any time in the 2 hours after the chosen time, so a restart or slow
 *    tick doesn't lose it. Later attempts only follow a no-answer or a
 *    callback request, at the retryAt the webhook set, up to 3 a day.
 *    A day with an answered call (manual ones included) is done.
 * 4. Claim the attempt by inserting its CheckinCall; the unique
 *    (userId, dateKey, attemptNumber) index makes a concurrent tick's
 *    insert fail instead of dialing twice.
 *
 * Driven once a minute, either by the in-process timer (inProcessScheduler.js)
 * or an external AWS EventBridge Scheduler calling POST /api/voice-agent/
 * checkin-call/scheduler-tick. Never both on a multi-instance deployment.
 */
export const runCheckinCallSchedulerTick = async (now = new Date()) => {
  if (!isSamvaadConfigured()) return { candidates: 0, fired: 0 }; // nothing to do until configured

  const allCandidates = await CycleSettings.find({
    checkinCallEnabled: true,
    checkinCallTime: { $regex: TIME_REGEX },
  });
  // Never phone a suspended or deleted account.
  const liveIds = await activeUserIdSet(allCandidates.map((settings) => settings.userId));
  const candidates = allCandidates.filter((settings) => liveIds.has(String(settings.userId)));

  let fired = 0;
  const skipped = {};
  const skip = (reason) => {
    skipped[reason] = (skipped[reason] || 0) + 1;
  };

  for (const settings of candidates) {
    try {
      const { userId } = settings;
      const clock = localClock(now, settings.checkinCallTimezoneOffsetMinutes);
      const scheduledMinutes = parseTimeOfDay(settings.checkinCallTime);

      const logs = await CycleLog.find({ userId })
        .sort({ dateKey: 1 })
        .select('dateKey flow date')
        .lean();
      const predictions = computeCyclePredictions(settings, logs, {
        today: dateFromDateKey(clock.dateKey),
      });
      const mode = settings.checkinCallMode || 'once';
      const callDay = resolveCallDay({
        mode,
        dayOffset: settings.checkinCallDayOffset,
        periodLength: settings.periodLength,
        predictions,
        dateKey: clock.dateKey,
      });
      if (!callDay) {
        skip('not_call_day');
        continue;
      }

      const cycleCap = mode === 'period_daily' ? settings.periodLength || 5 : 1;
      const answeredThisCycle = await CheckinCall.countDocuments({
        userId,
        cycleKey: callDay.cycleKey,
        outcome: 'completed',
        dateKey: { $ne: clock.dateKey },
      });
      if (answeredThisCycle >= cycleCap) {
        skip('cycle_complete');
        continue;
      }

      const todaysCalls = await CheckinCall.find({ userId, dateKey: clock.dateKey }).lean();
      const plan = planScheduledAttempt({ calls: todaysCalls, scheduledMinutes, now, clock });
      if (!plan.due) {
        skip(plan.reason);
        continue;
      }

      const previous = todaysCalls
        .filter((call) => call.attemptNumber)
        .sort((a, b) => b.attemptNumber - a.attemptNumber)[0];

      try {
        await placeCheckinCall({
          userId,
          source: plan.source,
          dateKey: clock.dateKey,
          cycleKey: callDay.cycleKey,
          attemptNumber: plan.attemptNumber,
          // Lets the agent open with "calling back like you asked".
          callReason: previous?.outcome === 'callback' ? 'callback' : plan.source,
        });
        fired += 1;
      } catch (error) {
        if (isDuplicateKey(error)) {
          skip('claimed_elsewhere');
          continue;
        }
        throw error;
      }
    } catch (error) {
      // One user's failure (no phone, a transient Sarvam error, etc.)
      // shouldn't stop the rest of this tick. The failed attempt is on its
      // CheckinCall, so it isn't retried every minute.
      logger.error('checkin_call_scheduler_tick_error', {
        action: 'checkin_call_scheduler_tick_error',
        userId: settings.userId,
        error: error.message,
      });
    }
  }

  return { candidates: candidates.length, fired, skipped };
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
