import { runCheckinCallSchedulerTick } from './checkinCallScheduler.js';
import { runDailyNotificationTick } from './dailyNotificationScheduler.js';
import logger from './logger.js';

const CHECKIN_TICK_MS = 60 * 1000; // 1 minute — matches checkinCallTime's minute-of-day precision
const DAILY_TICK_MS = 60 * 60 * 1000; // 1 hour — coarser than the daily reminders actually need,
// but running more often than the "once a day" cadence in README.md's
// Scheduled Jobs table is safe (each tick self-guards against re-firing the
// same day via lastPeriodReminderCycleKey/lastDailyNudgeDateKey/etc.), and
// an hourly cadence means a server restart can never push the *day's* tick
// out by up to a full day the way a single setInterval(ms=24h) from boot
// time could.

let checkinIntervalHandle = null;
let dailyIntervalHandle = null;

// Both scheduled features (README.md's "Scheduled jobs" section) are
// designed to be driven by an external scheduler (AWS EventBridge) hitting
// the /scheduler-tick and /daily-tick HTTP endpoints — so a multi-instance
// deployment never double-fires the same job from N processes each running
// their own timer. This in-process fallback exists because that external
// scheduler is opt-in infrastructure outside this repo: without it (no
// CHECKIN_CALL_SCHEDULER_SECRET/NOTIFICATION_SCHEDULER_SECRET configured,
// no AWS schedule created), the manual "call me now" button works (it's a
// direct API call) but recurring check-in calls and daily reminders never
// fire at all, since literally nothing is ever invoking either tick.
//
// Set ENABLE_IN_PROCESS_SCHEDULER=false once a real external scheduler is
// wired up (required for a horizontally-scaled, multi-instance deployment —
// running this in every instance would double/triple-fire each tick).
const isEnabled = () => process.env.ENABLE_IN_PROCESS_SCHEDULER !== 'false';

const runTickSafely = async (name, runTick) => {
  try {
    const result = await runTick();
    logger.info(name, { action: name, source: 'in_process_scheduler', ...result });
  } catch (error) {
    logger.error(`${name}_failed`, {
      action: `${name}_failed`,
      source: 'in_process_scheduler',
      error: error.message,
    });
  }
};

export const startInProcessScheduler = () => {
  if (!isEnabled()) {
    logger.info('in_process_scheduler_disabled', { action: 'in_process_scheduler_disabled' });
    return;
  }
  if (checkinIntervalHandle || dailyIntervalHandle) return; // already started

  // Fire once shortly after boot (rather than waiting a full interval for
  // the first tick), then on the regular cadence.
  setTimeout(() => runTickSafely('checkin_call_scheduler_tick', runCheckinCallSchedulerTick), 5000);
  setTimeout(() => runTickSafely('daily_notification_tick', runDailyNotificationTick), 10000);

  checkinIntervalHandle = setInterval(
    () => runTickSafely('checkin_call_scheduler_tick', runCheckinCallSchedulerTick),
    CHECKIN_TICK_MS,
  );
  checkinIntervalHandle.unref();

  dailyIntervalHandle = setInterval(
    () => runTickSafely('daily_notification_tick', runDailyNotificationTick),
    DAILY_TICK_MS,
  );
  dailyIntervalHandle.unref();

  logger.info('in_process_scheduler_started', {
    action: 'in_process_scheduler_started',
    checkinTickMs: CHECKIN_TICK_MS,
    dailyTickMs: DAILY_TICK_MS,
  });
};

export const stopInProcessScheduler = () => {
  if (checkinIntervalHandle) clearInterval(checkinIntervalHandle);
  if (dailyIntervalHandle) clearInterval(dailyIntervalHandle);
  checkinIntervalHandle = null;
  dailyIntervalHandle = null;
};
