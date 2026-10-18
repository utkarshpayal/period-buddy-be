// Pure helpers for the outbound "Buddy" check-in call (samvaadClient.js +
// voiceAgentController.js's checkinCallWebhook), kept free of I/O so they
// can be unit tested.

// The user base is India-only and the Sarvam agent's log tool already sends
// a static `timezoneOffsetMinutes: -330`, so a call's "today" is IST, not the
// server's UTC. A 1am IST call would otherwise log against yesterday.
export const IST_OFFSET_MINUTES = 330;

const DAY_MS = 24 * 60 * 60 * 1000;

export const checkinDateKey = (now = new Date()) =>
  new Date(now.getTime() + IST_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const weekdayOf = (dateKey) => WEEKDAYS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];

/**
 * Plain-English period timing the agent can say out loud, so the LLM never
 * has to do date arithmetic itself (it gets that wrong often enough on a
 * live call to matter). Returns '' when there's no prediction.
 */
export const describePeriodTiming = (expectedDateKey, todayKey) => {
  if (!expectedDateKey || !todayKey) return '';
  const diff = Math.round(
    (new Date(`${expectedDateKey}T00:00:00Z`) - new Date(`${todayKey}T00:00:00Z`)) / DAY_MS,
  );
  if (!Number.isFinite(diff)) return '';
  if (diff === 0) return 'expected today';
  if (diff === 1) return 'expected tomorrow';
  if (diff > 1) return `expected in ${diff} days`;
  if (diff === -1) return 'was expected yesterday, about 1 day late';
  return `was expected ${-diff} days ago, about ${-diff} days late`;
};

// Post-call variables on the Sarvam agent are named after these CycleLog
// fields on purpose, so the webhook can save them without a mapping table.
export const CHECKIN_BACKFILL_FIELDS = [
  'flow',
  'mood',
  'energy',
  'symptoms',
  'sleepHours',
  'waterIntake',
  'stressLevel',
  'digestion',
  'skin',
  'exercise',
  'medication',
  'weight',
  'temperature',
];

// What the agent's post-call extraction writes for a topic that never came
// up. upsertCycleLog strips 'not_discussed' itself; the rest would otherwise
// be stored as a literal symptom/medication/exercise.
const PLACEHOLDERS = new Set(['', 'not_discussed', 'none reported', 'unknown', 'n/a', 'na']);

// For the free-text list fields "none" means "nothing to log". It can't be a
// placeholder everywhere, because `flow: 'none'` is a real value.
const LIST_FIELDS = new Set(['symptoms', 'exercise', 'medication']);
const LIST_NONE = new Set(['none', 'nothing', 'no']);

const isBlank = (value, field) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && PLACEHOLDERS.has(value.trim().toLowerCase())) ||
  (typeof value === 'string' &&
    LIST_FIELDS.has(field) &&
    LIST_NONE.has(value.trim().toLowerCase())) ||
  (Array.isArray(value) && value.length === 0);

/**
 * The webhook is the backup path: the agent's in-call `log_cycle_entry`
 * tool is what normally saves the check-in. So from the call's final
 * variables, keep only the fields today's log doesn't already have. A value
 * the tool (or the user in the app) already saved always wins.
 *
 * Returns {} when there is nothing to add. `symptoms` is carried over from
 * the existing log when not being filled, because upsertCycleLog treats a
 * missing `symptoms` as an empty list and would otherwise wipe it.
 */
export const buildCheckinBackfill = (finalVars, existingLog) => {
  if (!finalVars || typeof finalVars !== 'object') return {};
  const payload = {};
  for (const field of CHECKIN_BACKFILL_FIELDS) {
    const value = finalVars[field];
    if (isBlank(value, field)) continue;
    if (existingLog && !isBlank(existingLog[field], field)) continue;
    payload[field] = value;
  }
  if (Object.keys(payload).length === 0) return {};
  if (!('symptoms' in payload) && existingLog?.symptoms?.length) {
    payload.symptoms = existingLog.symptoms;
  }
  return payload;
};

/* ──────────────────────────────────────────────
   Scheduling, retries and limits
────────────────────────────────────────────── */

export const CALL_LIMITS = {
  // Automatic attempts per day: the scheduled call plus up to two retries.
  maxAutoAttemptsPerDay: 3,
  // How long after the chosen time a missed tick (restart, deploy, slow
  // tick) can still place the day's first call.
  catchUpMinutes: 120,
  noAnswerRetryMinutes: 30,
  callbackRetryMinutes: 60,
  dialFailureRetryMinutes: 10,
  // A call with no webhook yet is treated as still ringing/talking for this
  // long (5 min cap + ringing + Sarvam queueing), then as unanswered.
  inFlightMinutes: 15,
  // Automatic retries never ring before 08:00 or after 21:30 local time. A
  // callback time the user asked for may go up to 23:00.
  quietStartMinutes: 21 * 60 + 30,
  quietEndMinutes: 8 * 60,
  latestCallbackMinutes: 23 * 60,
  // "Call me now" from the app.
  manualPerDay: 3,
  manualCooldownMinutes: 10,
};

// Date.prototype.getTimezoneOffset() convention (UTC − local), so IST is -330.
export const DEFAULT_TZ_OFFSET_MINUTES = -IST_OFFSET_MINUTES;

const MINUTE_MS = 60 * 1000;

const toTzOffset = (value) =>
  value === null || value === undefined || !Number.isFinite(Number(value))
    ? DEFAULT_TZ_OFFSET_MINUTES
    : Number(value);

/** The user's local date and minute-of-day at `now`. */
export const localClock = (now, tzOffsetMinutes) => {
  const tzOffset = toTzOffset(tzOffsetMinutes);
  const local = new Date(now.getTime() - tzOffset * MINUTE_MS);
  return {
    dateKey: local.toISOString().slice(0, 10),
    minutes: local.getUTCHours() * 60 + local.getUTCMinutes(),
    tzOffset,
  };
};

/** 'HH:mm' → minute of day, or null. */
export const parseTimeOfDay = (value) => {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || '').trim());
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/** A local date + minute-of-day as a real instant. */
export const localMomentToDate = (dateKey, minutes, tzOffsetMinutes) =>
  new Date(
    Date.parse(`${dateKey}T00:00:00Z`) + (minutes + toTzOffset(tzOffsetMinutes)) * MINUTE_MS,
  );

const dayDiff = (laterKey, earlierKey) =>
  Math.round(
    (Date.parse(`${laterKey}T00:00:00Z`) - Date.parse(`${earlierKey}T00:00:00Z`)) / DAY_MS,
  );

export const addDaysToKey = (dateKey, days) =>
  new Date(Date.parse(`${dateKey}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

/**
 * Is `dateKey` a call day, and which cycle does it count against?
 * `predictions` must be computeCyclePredictions(..., { today: dateKey }), so
 * `currentPeriodStartDateISO` is the start of the cycle that contains
 * `dateKey` (a start falling on `dateKey` itself counts as current).
 *
 * - 'period_daily': every day of the period, days 1..periodLength.
 * - 'once': one day per cycle, period start + dayOffset. Checked against
 *   both the current and the next start, because the next start is always
 *   strictly after `dateKey` and a "period day" or "N days after" call
 *   would otherwise never match.
 *
 * Returns { cycleKey, periodDay } or null.
 */
export const resolveCallDay = ({ mode, dayOffset = 0, periodLength = 5, predictions, dateKey }) => {
  if (!predictions?.currentPeriodStartDateISO) return null;
  const currentStart = predictions.currentPeriodStartDateISO.slice(0, 10);

  if (mode === 'period_daily') {
    const periodDay = dayDiff(dateKey, currentStart) + 1;
    const length = Math.max(1, Math.min(Number(periodLength) || 5, 10));
    return periodDay >= 1 && periodDay <= length ? { cycleKey: currentStart, periodDay } : null;
  }

  const starts = [currentStart, predictions.nextPeriodDateISO?.slice(0, 10)].filter(Boolean);
  for (const start of starts) {
    if (addDaysToKey(start, Number(dayOffset) || 0) === dateKey) {
      const periodDay = dayDiff(dateKey, start) + 1;
      return { cycleKey: start, periodDay: periodDay >= 1 ? periodDay : null };
    }
  }
  return null;
};

// A day with one of these is finished: the user talked to Buddy (or clearly
// shouldn't be called again today).
const DAY_DONE_OUTCOMES = new Set([
  'completed',
  'declined',
  'opted_out',
  'wrong_person',
  'dropped',
]);
const IN_FLIGHT_STATUSES = new Set(['dialing', 'requested']);

const isInFlight = (call, now) =>
  IN_FLIGHT_STATUSES.has(call.status) &&
  now - new Date(call.createdAt) < CALL_LIMITS.inFlightMinutes * MINUTE_MS;

/**
 * Is `clock` inside the day's first-call window (chosen time up to
 * catchUpMinutes later)? With no automatic attempt yet today, this is the
 * only time planScheduledAttempt can return due, so the scheduler uses it
 * to skip everyone else before loading their logs and calls.
 */
export const inFirstCallWindow = ({ clock, scheduledMinutes }) => {
  if (scheduledMinutes === null || scheduledMinutes === undefined) return false;
  const late = clock.minutes - scheduledMinutes;
  return late >= 0 && late < CALL_LIMITS.catchUpMinutes;
};

/**
 * Should the scheduler place an automatic call for this user right now?
 * `calls` are all of the user's CheckinCalls for `clock.dateKey` (manual
 * ones included: a "call me now" the user already answered today means the
 * scheduled one isn't needed).
 *
 * Returns { due: true, attemptNumber, source } or { due: false, reason }.
 */
export const planScheduledAttempt = ({ calls = [], scheduledMinutes, now, clock }) => {
  if (calls.some((call) => DAY_DONE_OUTCOMES.has(call.outcome))) {
    return { due: false, reason: 'done_today' };
  }
  if (calls.some((call) => isInFlight(call, now))) return { due: false, reason: 'in_flight' };

  const autos = calls
    .filter((call) => call.attemptNumber)
    .sort((a, b) => a.attemptNumber - b.attemptNumber);

  if (autos.length === 0) {
    if (scheduledMinutes === null || scheduledMinutes === undefined) {
      return { due: false, reason: 'no_time' };
    }
    const late = clock.minutes - scheduledMinutes;
    if (late < 0) return { due: false, reason: 'not_yet' };
    if (late >= CALL_LIMITS.catchUpMinutes) return { due: false, reason: 'window_passed' };
    return { due: true, attemptNumber: 1, source: 'scheduled' };
  }

  if (autos.length >= CALL_LIMITS.maxAutoAttemptsPerDay) {
    return { due: false, reason: 'max_attempts' };
  }
  const last = autos[autos.length - 1];
  // A call whose webhook never arrived is treated as unanswered.
  const retryAt =
    last.retryAt ||
    (IN_FLIGHT_STATUSES.has(last.status)
      ? new Date(
          new Date(last.createdAt).getTime() +
            (CALL_LIMITS.inFlightMinutes + CALL_LIMITS.noAnswerRetryMinutes) * MINUTE_MS,
        )
      : null);
  if (!retryAt) return { due: false, reason: 'no_retry' };
  if (now < new Date(retryAt)) return { due: false, reason: 'retry_pending' };
  if (clock.minutes < CALL_LIMITS.quietEndMinutes) return { due: false, reason: 'quiet_hours' };
  if (clock.minutes >= CALL_LIMITS.latestCallbackMinutes) {
    return { due: false, reason: 'quiet_hours' };
  }
  return { due: true, attemptNumber: last.attemptNumber + 1, source: 'retry' };
};

/**
 * What a finished call amounted to, from Sarvam's status and the agent's
 * post-call `call_disposition`. Only 'no_answer', 'failed' and 'callback'
 * are retried.
 */
export const classifyCallOutcome = ({ status, disposition, durationSeconds, logStatus }) => {
  if (status === 'failed') return 'failed';
  if (status !== 'connected') return 'no_answer';
  const seconds = Number(durationSeconds) || 0;
  switch (disposition) {
    case 'callback_requested':
      return 'callback';
    case 'opted_out':
      return 'opted_out';
    case 'wrong_person':
      return 'wrong_person';
    case 'declined':
      return 'declined';
    case 'completed':
    case 'partial':
    case 'health_concern':
      return 'completed';
    case 'dropped_off':
      // Picked up and hung up straight away, or voicemail: not a conversation.
      if (seconds < 30) return 'no_answer';
      return logStatus === 'logged' ? 'completed' : 'dropped';
    default:
      return seconds < 20 ? 'no_answer' : 'completed';
  }
};

/**
 * When to try again after an automatic attempt, or null for no retry today.
 * Retries stay on the same local day, outside quiet hours, and within the
 * daily attempt cap. A callback time the user named ('HH:mm') is used when
 * it is at least 5 minutes away; otherwise the default delay applies.
 */
export const planRetry = ({ outcome, source, attemptNumber, now, clock, callbackTime }) => {
  if (source === 'manual') return null;
  if (!attemptNumber || attemptNumber >= CALL_LIMITS.maxAutoAttemptsPerDay) return null;

  let at;
  let latest = CALL_LIMITS.quietStartMinutes;
  if (outcome === 'no_answer') {
    at = new Date(now.getTime() + CALL_LIMITS.noAnswerRetryMinutes * MINUTE_MS);
  } else if (outcome === 'failed') {
    at = new Date(now.getTime() + CALL_LIMITS.dialFailureRetryMinutes * MINUTE_MS);
  } else if (outcome === 'callback') {
    const asked = parseTimeOfDay(callbackTime);
    if (asked !== null && asked >= clock.minutes + 5) {
      at = localMomentToDate(clock.dateKey, asked, clock.tzOffset);
      latest = CALL_LIMITS.latestCallbackMinutes;
    } else {
      at = new Date(now.getTime() + CALL_LIMITS.callbackRetryMinutes * MINUTE_MS);
    }
  } else {
    return null;
  }

  const atClock = localClock(at, clock.tzOffset);
  if (atClock.dateKey !== clock.dateKey || atClock.minutes > latest) return null;
  if (atClock.minutes < CALL_LIMITS.quietEndMinutes) {
    return localMomentToDate(clock.dateKey, CALL_LIMITS.quietEndMinutes, clock.tzOffset);
  }
  return at;
};

/**
 * "Call me now" limits. `calls` are the user's CheckinCalls for today.
 * Returns null when allowed, else { statusCode, message, retryAfterSeconds }.
 */
export const checkManualCallLimit = ({ calls = [], now }) => {
  if (calls.some((call) => isInFlight(call, now))) {
    return {
      statusCode: 409,
      message: 'Buddy is already calling you. Please pick up, or try again in a few minutes.',
      retryAfterSeconds: 5 * 60,
    };
  }
  const manual = calls
    .filter((call) => call.source === 'manual')
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (manual.length >= CALL_LIMITS.manualPerDay) {
    return {
      statusCode: 429,
      message: `You've used all ${CALL_LIMITS.manualPerDay} check-in calls for today. You can log in the app any time.`,
      retryAfterSeconds: null,
    };
  }
  if (manual[0]) {
    const waitMs =
      new Date(manual[0].createdAt).getTime() +
      CALL_LIMITS.manualCooldownMinutes * MINUTE_MS -
      now.getTime();
    if (waitMs > 0) {
      const minutes = Math.ceil(waitMs / MINUTE_MS);
      return {
        statusCode: 429,
        message: `You can request another call in ${minutes} minute${minutes === 1 ? '' : 's'}.`,
        retryAfterSeconds: Math.ceil(waitMs / 1000),
      };
    }
  }
  return null;
};

const PHASE_LABELS = {
  period: 'period',
  follicular: 'follicular phase',
  ovulation: 'ovulation window',
  luteal: 'luteal phase',
};

/** One spoken-friendly line about where the user is in their cycle. */
export const describeCycleContext = ({ predictions, periodDay, periodLength }) => {
  const parts = [];
  if (periodDay && periodDay >= 1 && periodDay <= (Number(periodLength) || 5)) {
    parts.push(`Day ${periodDay} of the period, which usually lasts ${periodLength || 5} days`);
  }
  if (predictions?.currentCycleDay) parts.push(`cycle day ${predictions.currentCycleDay}`);
  const phase = PHASE_LABELS[predictions?.currentPhase];
  if (phase && !parts[0]?.startsWith('Day')) parts.push(phase);
  return parts.length ? `${parts.join(', ')}.` : '';
};

/**
 * The most recent log in the last 3 days, as a short line the agent can
 * refer to ("yesterday you had cramps"). '' when there's nothing recent.
 */
export const summarizeRecentLog = (log, todayKey) => {
  if (!log?.dateKey || !todayKey) return '';
  const age = dayDiff(todayKey, log.dateKey);
  if (age < 0 || age > 3) return '';
  const when = age === 0 ? 'Earlier today' : age === 1 ? 'Yesterday' : `${age} days ago`;
  const bits = [];
  if (log.flow && log.flow !== 'none') bits.push(`${log.flow} flow`);
  if (log.symptoms?.length) bits.push(log.symptoms.slice(0, 3).join(', '));
  if (log.mood) bits.push(`mood ${log.mood}`);
  if (log.sleepHours) bits.push(`slept ${log.sleepHours} hours`);
  return bits.length ? `${when}: ${bits.join('; ')}.` : '';
};
