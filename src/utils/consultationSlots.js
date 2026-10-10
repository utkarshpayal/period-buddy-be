import {
  DEFAULT_TIME_ZONE,
  isValidTimeZone,
  parseHHMM,
  zonedParts,
  zonedTimeToUtc,
} from './timezone.js';

/**
 * Bookable consultation slots, built from a doctor's weekly hours.
 *
 * A DoctorAvailability range is "dayOfWeek, startTime-endTime, maxSlots" in
 * the doctor's time zone: the range is split into `maxSlots` equal slots,
 * each for one patient (09:00-12:00 with 4 slots → 45-minute slots at 09:00,
 * 09:45, 10:30, 11:15). Every slot is identified by its UTC start instant,
 * which is what a booking stores in Consultation.scheduledFor.
 *
 * A DoctorDateOverride replaces the weekly hours on one calendar date: its
 * own ranges, or none for a day off.
 */

/** How far ahead patients can book (default; each doctor can change it). */
export const BOOKING_WINDOW_DAYS = 14;
export const MAX_BOOKING_WINDOW_DAYS = 90;
/** A slot must start at least this long from now to be bookable (default). */
export const BOOKING_LEAD_MINUTES = 15;
/** Longest minimum notice a doctor may ask for: one week. */
export const MAX_BOOKING_LEAD_MINUTES = 7 * 24 * 60;
/** Most date overrides one doctor may keep. */
export const MAX_DATE_OVERRIDES = 400;
/** Most ranges on one day. */
export const MAX_RANGES_PER_DAY = 12;
/** An unpaid checkout holds its slot this long, so two people can't pay for it. */
export const PAYMENT_HOLD_MINUTES = 15;
/** Shortest slot a range may be split into. */
export const MIN_SLOT_MINUTES = 10;
/** Most slots one range may have (when it's split into `maxSlots` parts). */
export const MAX_SLOTS_PER_RANGE = 24;
/** Consultation length a doctor may pick (a range with `slotMinutes`). */
export const MAX_SLOT_MINUTES = 240;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Slot length in minutes for a range, or null when it can't be split sensibly. */
export const slotLengthFor = (startTime, endTime, maxSlots) => {
  const start = parseHHMM(startTime);
  const end = parseHHMM(endTime);
  const count = Number(maxSlots);
  if (start === null || end === null || end <= start) return null;
  if (!Number.isInteger(count) || count < 1 || count > MAX_SLOTS_PER_RANGE) return null;
  const length = Math.floor((end - start) / count);
  return length >= MIN_SLOT_MINUTES ? length : null;
};

const hasFixedLength = (r) => r?.slotMinutes !== undefined && r?.slotMinutes !== null;

/**
 * How a range splits into slots: `{ length, count }`, or null when it can't.
 * A range with `slotMinutes` is cut into back-to-back consultations of that
 * length (09:00-12:00 at 30 → 6 slots); an older one without it is split
 * into `maxSlots` equal parts.
 */
export const rangePlan = (range) => {
  const start = parseHHMM(range?.startTime);
  const end = parseHHMM(range?.endTime);
  if (start === null || end === null || end <= start) return null;
  if (hasFixedLength(range)) {
    const length = range.slotMinutes;
    if (!Number.isInteger(length) || length < MIN_SLOT_MINUTES || length > MAX_SLOT_MINUTES)
      return null;
    const count = Math.floor((end - start) / length);
    return count >= 1 ? { length, count } : null;
  }
  const length = slotLengthFor(range.startTime, range.endTime, range.maxSlots);
  return length ? { length, count: range.maxSlots } : null;
};

/** Problem with one range's times and slot count, or null. */
const rangeProblem = (r) => {
  const start = parseHHMM(r?.startTime);
  const end = parseHHMM(r?.endTime);
  if (start === null || end === null) return 'Times must be HH:MM (24-hour)';
  if (end <= start) return 'Each range must end after it starts';
  if (hasFixedLength(r)) {
    if (
      !Number.isInteger(r.slotMinutes) ||
      r.slotMinutes < MIN_SLOT_MINUTES ||
      r.slotMinutes > MAX_SLOT_MINUTES
    ) {
      return `Consultation length must be ${MIN_SLOT_MINUTES} to ${MAX_SLOT_MINUTES} minutes`;
    }
    if (end - start < r.slotMinutes) return 'Each range must fit at least one consultation';
    return null;
  }
  if (!Number.isInteger(r.maxSlots) || r.maxSlots < 1 || r.maxSlots > MAX_SLOTS_PER_RANGE) {
    return `Slots per range must be a whole number from 1 to ${MAX_SLOTS_PER_RANGE}`;
  }
  if (!slotLengthFor(r.startTime, r.endTime, r.maxSlots)) {
    return `Each slot must be at least ${MIN_SLOT_MINUTES} minutes: use fewer slots or a longer range`;
  }
  return null;
};

/** Whether any two of one day's ranges overlap. */
const overlaps = (ranges) => {
  const sorted = ranges
    .map((r) => ({ start: parseHHMM(r.startTime), end: parseHHMM(r.endTime) }))
    .sort((a, b) => a.start - b.start);
  return sorted.some((r, i) => i > 0 && r.start < sorted[i - 1].end);
};

/**
 * Validate one doctor's full weekly schedule (what PUT /api/doctor/availability
 * receives). Returns an error message, or null when every range is valid.
 */
export const validateWeeklyRanges = (ranges) => {
  if (!Array.isArray(ranges)) return 'slots must be an array';
  if (ranges.length > 7 * MAX_RANGES_PER_DAY) return 'Too many time ranges';
  const byDay = new Map();
  for (const r of ranges) {
    if (!Number.isInteger(r?.dayOfWeek) || r.dayOfWeek < 0 || r.dayOfWeek > 6) {
      return 'Each range needs a dayOfWeek from 0 (Sunday) to 6 (Saturday)';
    }
    const problem = rangeProblem(r);
    if (problem) return problem;
    if (r.timezone !== undefined && !isValidTimeZone(r.timezone)) {
      return 'Unknown time zone';
    }
    byDay.set(r.dayOfWeek, [...(byDay.get(r.dayOfWeek) || []), r]);
  }
  for (const day of byDay.values()) {
    if (overlaps(day)) return 'Time ranges on the same day overlap';
  }
  const zones = new Set(ranges.map((r) => r.timezone).filter(Boolean));
  if (zones.size > 1) return 'All ranges must use the same time zone';
  return null;
};

/** Whether `value` is a real calendar date written "YYYY-MM-DD". */
export const isDateKey = (value) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1]) &&
    d.getUTCMonth() === Number(m[2]) - 1 &&
    d.getUTCDate() === Number(m[3])
  );
};

/** "YYYY-MM-DD" of wall-clock parts ({ year, month, day }). */
export const dateKeyOf = ({ year, month, day }) =>
  `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

/**
 * Validate a doctor's date overrides: `[{ date, ranges: [{ startTime,
 * endTime, maxSlots }], note? }]`. An empty `ranges` is a day off.
 */
export const validateDateOverrides = (overrides) => {
  if (!Array.isArray(overrides)) return 'overrides must be an array';
  if (overrides.length > MAX_DATE_OVERRIDES) return 'Too many date overrides';
  const seen = new Set();
  for (const o of overrides) {
    if (!isDateKey(o?.date)) return 'Each date override needs a date as YYYY-MM-DD';
    if (seen.has(o.date)) return `${o.date} is listed twice`;
    seen.add(o.date);
    if (!Array.isArray(o.ranges)) return `${o.date}: ranges must be an array`;
    if (o.ranges.length > MAX_RANGES_PER_DAY) return `${o.date}: too many time ranges`;
    for (const r of o.ranges) {
      const problem = rangeProblem(r);
      if (problem) return `${o.date}: ${problem}`;
    }
    if (overlaps(o.ranges)) return `${o.date}: time ranges overlap`;
    if (
      o.note !== undefined &&
      o.note !== null &&
      (typeof o.note !== 'string' || o.note.length > 120)
    ) {
      return `${o.date}: the note must be text of at most 120 characters`;
    }
  }
  return null;
};

/**
 * Every slot in the booking window, earliest first:
 * `[{ start: Date, end: Date, timezone }]`. `ranges` are the doctor's
 * DoctorAvailability rows (only `isAvailable` ones are used) and `overrides`
 * their DoctorDateOverride rows, which replace the weekly hours on their
 * date. Slots starting within `leadMinutes` of `now`, and those in
 * `takenStarts` (a Set of start times in ms), are left out.
 */
export const buildSlots = (
  ranges,
  {
    now = new Date(),
    days = BOOKING_WINDOW_DAYS,
    leadMinutes = BOOKING_LEAD_MINUTES,
    takenStarts = new Set(),
    overrides = [],
  } = {},
) => {
  const earliest = now.getTime() + leadMinutes * 60000;
  const latest = now.getTime() + days * DAY_MS;
  const slots = [];

  const addRange = (range, { year, month, day }, tz) => {
    const plan = rangePlan(range);
    if (!plan) return;
    const { length, count } = plan;
    const startMinutes = parseHHMM(range.startTime);
    for (let n = 0; n < count; n += 1) {
      const minutes = startMinutes + n * length;
      const start = zonedTimeToUtc(
        { year, month, day, hour: Math.floor(minutes / 60), minute: minutes % 60 },
        tz,
      );
      if (start.getTime() < earliest || start.getTime() > latest) continue;
      if (takenStarts.has(start.getTime())) continue;
      slots.push({ start, end: new Date(start.getTime() + length * 60000), timezone: tz });
    }
  };

  const overridden = new Set(
    (overrides || []).filter((o) => isDateKey(o?.date)).map((o) => o.date),
  );

  // Weekly hours, walking calendar days in the doctor's zone (one extra each
  // side covers zones far from the server's), except overridden dates.
  for (const range of (ranges || []).filter((r) => r && r.isAvailable !== false)) {
    const tz = isValidTimeZone(range.timezone) ? range.timezone : DEFAULT_TIME_ZONE;
    for (let i = -1; i <= days; i += 1) {
      const local = zonedParts(new Date(now.getTime() + i * DAY_MS), tz);
      if (local.weekday !== range.dayOfWeek || overridden.has(dateKeyOf(local))) continue;
      addRange(range, local, tz);
    }
  }

  for (const override of overrides || []) {
    if (!isDateKey(override?.date)) continue;
    const tz = isValidTimeZone(override.timezone) ? override.timezone : DEFAULT_TIME_ZONE;
    const [year, month, day] = override.date.split('-').map(Number);
    for (const range of override.ranges || []) addRange(range, { year, month, day }, tz);
  }

  const seen = new Set();
  return slots
    .sort((a, b) => a.start - b.start)
    .filter((s) => (seen.has(s.start.getTime()) ? false : seen.add(s.start.getTime())));
};

/** The slot starting exactly at `instant` (a Date), if it's bookable. */
export const findSlot = (ranges, instant, options) =>
  buildSlots(ranges, options).find((s) => s.start.getTime() === instant.getTime()) || null;

/**
 * Whether `instant` is a slot start under this schedule at all, ignoring the
 * booking window, notice and taken slots (used to flag booked sessions that a
 * schedule change left outside the doctor's hours).
 */
export const isScheduledSlot = (ranges, overrides, instant) =>
  Boolean(
    findSlot(ranges, instant, {
      now: new Date(instant.getTime() - DAY_MS),
      days: 2,
      leadMinutes: 0,
      overrides,
    }),
  );
