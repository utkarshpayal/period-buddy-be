// Pure recurrence helpers for scheduled/repeating admin pushes
// (models/PushSchedule.js, utils/pushScheduleRunner.js). Kept free of I/O so
// they can be unit tested.
//
// Every wall-clock rule ("daily at 9:00", "Mondays", "the 15th") is read in
// IST: the user base is India-only (see utils/checkinCall.js) and India has no
// DST, so a fixed +5:30 offset is exact.
import { IST_OFFSET_MINUTES } from './checkinCall.js';

export const REPEAT_KINDS = ['none', 'daily', 'weekly', 'monthly'];
export const MAX_INTERVAL = 30;
export const MAX_RUNS = 1000;

const OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// "Local" dates are UTC Dates shifted by the IST offset, so getUTC*() on them
// reads IST wall-clock fields.
const toLocal = (date) => new Date(date.getTime() + OFFSET_MS);
const fromLocal = (local) => new Date(local.getTime() - OFFSET_MS);

const localMidnight = (local) =>
  Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());

const daysInMonth = (year, month) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * The first occurrence strictly after `after`, or null when the schedule has
 * no more (a one-time send already made, past `endAt`, or `maxRuns` reached).
 *
 * @param {object} schedule
 * @param {Date}   schedule.startAt     First send; also fixes the time of day
 *                                      (and weekday / day of month) in IST.
 * @param {string} schedule.repeat      'none' | 'daily' | 'weekly' | 'monthly'
 * @param {number} [schedule.interval]  Every N days/weeks/months (default 1).
 * @param {number[]} [schedule.daysOfWeek] Weekly only: 0 = Sunday … 6 = Saturday (IST).
 * @param {Date}   [schedule.endAt]     No occurrence after this moment.
 * @param {number} [schedule.maxRuns]   Stop after this many sends.
 * @param {number} [schedule.runCount]  Sends made so far.
 * @param {Date}   after
 */
export const nextOccurrence = (schedule, after) => {
  const { repeat = 'none', endAt, maxRuns, runCount = 0 } = schedule;
  const startAt = new Date(schedule.startAt);
  if (Number.isNaN(startAt.getTime())) return null;
  if (maxRuns && runCount >= maxRuns) return null;

  const interval = Math.max(1, Math.floor(schedule.interval || 1));
  let next = null;

  if (repeat === 'none') {
    next = runCount === 0 && startAt > after ? startAt : null;
  } else if (startAt > after) {
    // Weekly with a weekday list may have an earlier matching day than the
    // start's own weekday; everything else starts exactly at startAt.
    next =
      repeat === 'weekly' ? nextWeekly(startAt, interval, schedule.daysOfWeek, after) : startAt;
  } else if (repeat === 'daily') {
    const period = interval * DAY_MS;
    const k = Math.floor((after - startAt) / period) + 1;
    next = new Date(startAt.getTime() + k * period);
  } else if (repeat === 'weekly') {
    next = nextWeekly(startAt, interval, schedule.daysOfWeek, after);
  } else if (repeat === 'monthly') {
    next = nextMonthly(startAt, interval, after);
  }

  if (!next) return null;
  if (endAt && next > new Date(endAt)) return null;
  return next;
};

const nextWeekly = (startAt, interval, daysOfWeek, after) => {
  const startLocal = toLocal(startAt);
  const days = normalizeDaysOfWeek(daysOfWeek, startLocal.getUTCDay());
  const timeOfDay = startLocal.getTime() - localMidnight(startLocal);
  // Weeks are counted from the Sunday of the start's week, so "every 2 weeks
  // on Mon + Thu" keeps the same two-week rhythm forever.
  const anchorWeek = localMidnight(startLocal) - startLocal.getUTCDay() * DAY_MS;

  const from = toLocal(after > startAt ? after : startAt);
  let day = localMidnight(from);
  // Worst case is one full cycle of `interval` weeks plus the partial week.
  for (let i = 0; i <= (interval + 1) * 7; i += 1, day += DAY_MS) {
    const week = Math.floor((day - anchorWeek) / WEEK_MS);
    if (week % interval !== 0) continue;
    if (!days.includes(new Date(day).getUTCDay())) continue;
    const candidate = fromLocal(new Date(day + timeOfDay));
    if (candidate > after && candidate >= startAt) return candidate;
  }
  return null;
};

const nextMonthly = (startAt, interval, after) => {
  const startLocal = toLocal(startAt);
  const dom = startLocal.getUTCDate();
  const timeOfDay = startLocal.getTime() - localMidnight(startLocal);
  const afterLocal = toLocal(after);
  const monthsBetween =
    (afterLocal.getUTCFullYear() - startLocal.getUTCFullYear()) * 12 +
    (afterLocal.getUTCMonth() - startLocal.getUTCMonth());
  // Start one step early in case this month's occurrence is still ahead.
  let k = Math.max(0, Math.floor(monthsBetween / interval) - 1);
  for (let i = 0; i < 4; i += 1, k += 1) {
    const m = startLocal.getUTCMonth() + k * interval;
    const year = startLocal.getUTCFullYear() + Math.floor(m / 12);
    const month = ((m % 12) + 12) % 12;
    // The 31st falls back to the month's last day rather than skipping it.
    const day = Math.min(dom, daysInMonth(year, month));
    const candidate = fromLocal(new Date(Date.UTC(year, month, day) + timeOfDay));
    if (candidate > after) return candidate;
  }
  return null;
};

export const normalizeDaysOfWeek = (value, fallbackDay) => {
  const days = Array.isArray(value)
    ? [...new Set(value.map(Number).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))]
    : [];
  return days.length > 0 ? days.sort((a, b) => a - b) : [fallbackDay];
};

/**
 * Validate the timing part of a create/update body. Returns
 * `{ schedule }` (normalized fields ready to store) or `{ error }`.
 * `now` is only used to reject a start time in the past, unless
 * `allowPastStart` (an already-running series being edited, or a repeating one
 * approved after its first slot — it just continues from the next occurrence).
 */
export const parseScheduleInput = (
  body = {},
  now = new Date(),
  { allowPastStart = false } = {},
) => {
  const repeat = body.repeat ?? 'none';
  if (!REPEAT_KINDS.includes(repeat)) return { error: 'Invalid repeat option' };

  const startAt = new Date(body.startAt);
  if (!body.startAt || Number.isNaN(startAt.getTime())) {
    return { error: 'Pick a date and time to send' };
  }
  // A minute of slack for "send at the current minute" from a slow form.
  if (!allowPastStart && startAt.getTime() < now.getTime() - 60 * 1000) {
    return { error: 'The send time is in the past' };
  }

  const schedule = { repeat, startAt, interval: 1 };
  if (repeat === 'none') return { schedule: { ...schedule, endAt: null, maxRuns: null } };

  const interval = body.interval === undefined ? 1 : Number(body.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > MAX_INTERVAL) {
    return { error: `Repeat interval must be a whole number from 1 to ${MAX_INTERVAL}` };
  }
  schedule.interval = interval;

  if (repeat === 'weekly') {
    schedule.daysOfWeek = normalizeDaysOfWeek(body.daysOfWeek, toLocal(startAt).getUTCDay());
  }

  schedule.endAt = null;
  if (body.endAt) {
    const endAt = new Date(body.endAt);
    if (Number.isNaN(endAt.getTime())) return { error: 'Invalid end date' };
    if (endAt <= startAt) return { error: 'The end date must be after the first send' };
    schedule.endAt = endAt;
  }

  schedule.maxRuns = null;
  if (body.maxRuns !== undefined && body.maxRuns !== null && body.maxRuns !== '') {
    const maxRuns = Number(body.maxRuns);
    if (!Number.isInteger(maxRuns) || maxRuns < 1 || maxRuns > MAX_RUNS) {
      return { error: `Number of sends must be from 1 to ${MAX_RUNS}` };
    }
    schedule.maxRuns = maxRuns;
  }

  return { schedule };
};

const WEEKDAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Short human label, e.g. "Every 2 weeks on Mon, Thu at 09:00 IST". */
export const describeSchedule = (schedule) => {
  const local = toLocal(new Date(schedule.startAt));
  const time = `${String(local.getUTCHours()).padStart(2, '0')}:${String(
    local.getUTCMinutes(),
  ).padStart(2, '0')} IST`;
  const n = schedule.interval || 1;
  const every = (unit) => (n === 1 ? `Every ${unit}` : `Every ${n} ${unit}s`);
  switch (schedule.repeat) {
    case 'daily':
      return `${n === 1 ? 'Daily' : every('day')} at ${time}`;
    case 'weekly': {
      const days = normalizeDaysOfWeek(schedule.daysOfWeek, local.getUTCDay())
        .map((d) => WEEKDAY_SHORT[d])
        .join(', ');
      return `${n === 1 ? 'Weekly' : every('week')} on ${days} at ${time}`;
    }
    case 'monthly':
      return `${n === 1 ? 'Monthly' : every('month')} on day ${local.getUTCDate()} at ${time}`;
    default:
      return `Once on ${local.toISOString().slice(0, 10)} at ${time}`;
  }
};
