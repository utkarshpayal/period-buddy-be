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
 */

/** How far ahead patients can book. */
export const BOOKING_WINDOW_DAYS = 14;
/** A slot must start at least this long from now to be bookable. */
export const BOOKING_LEAD_MINUTES = 15;
/** An unpaid checkout holds its slot this long, so two people can't pay for it. */
export const PAYMENT_HOLD_MINUTES = 15;
/** Shortest slot a range may be split into. */
export const MIN_SLOT_MINUTES = 10;
/** Most slots one range may have. */
export const MAX_SLOTS_PER_RANGE = 24;

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

/**
 * Validate one doctor's full weekly schedule (what PUT /api/doctor/availability
 * receives). Returns an error message, or null when every range is valid.
 */
export const validateWeeklyRanges = (ranges) => {
  if (!Array.isArray(ranges)) return 'slots must be an array';
  if (ranges.length > 7 * 12) return 'Too many time ranges';
  const byDay = new Map();
  for (const r of ranges) {
    if (!Number.isInteger(r?.dayOfWeek) || r.dayOfWeek < 0 || r.dayOfWeek > 6) {
      return 'Each range needs a dayOfWeek from 0 (Sunday) to 6 (Saturday)';
    }
    const start = parseHHMM(r.startTime);
    const end = parseHHMM(r.endTime);
    if (start === null || end === null) return 'Times must be HH:MM (24-hour)';
    if (end <= start) return 'Each range must end after it starts';
    if (!Number.isInteger(r.maxSlots) || r.maxSlots < 1 || r.maxSlots > MAX_SLOTS_PER_RANGE) {
      return `Slots per range must be a whole number from 1 to ${MAX_SLOTS_PER_RANGE}`;
    }
    if (!slotLengthFor(r.startTime, r.endTime, r.maxSlots)) {
      return `Each slot must be at least ${MIN_SLOT_MINUTES} minutes: use fewer slots or a longer range`;
    }
    if (r.timezone !== undefined && !isValidTimeZone(r.timezone)) {
      return 'Unknown time zone';
    }
    const day = byDay.get(r.dayOfWeek) || [];
    for (const other of day) {
      if (start < other.end && other.start < end) return 'Time ranges on the same day overlap';
    }
    day.push({ start, end });
    byDay.set(r.dayOfWeek, day);
  }
  const zones = new Set(ranges.map((r) => r.timezone).filter(Boolean));
  if (zones.size > 1) return 'All ranges must use the same time zone';
  return null;
};

/**
 * Every slot in the booking window, earliest first:
 * `[{ start: Date, end: Date, timezone }]`. `ranges` are the doctor's
 * DoctorAvailability rows (only `isAvailable` ones are used). Slots starting
 * within BOOKING_LEAD_MINUTES of `now`, and those in `takenStarts` (a Set of
 * start times in ms), are left out.
 */
export const buildSlots = (
  ranges,
  { now = new Date(), days = BOOKING_WINDOW_DAYS, takenStarts = new Set() } = {},
) => {
  const earliest = now.getTime() + BOOKING_LEAD_MINUTES * 60000;
  const slots = [];
  const active = (ranges || []).filter((r) => r && r.isAvailable !== false);

  for (const range of active) {
    const tz = isValidTimeZone(range.timezone) ? range.timezone : DEFAULT_TIME_ZONE;
    const length = slotLengthFor(range.startTime, range.endTime, range.maxSlots);
    if (!length) continue;
    const startMinutes = parseHHMM(range.startTime);

    // Walk calendar days in the doctor's zone (one extra each side covers
    // zones far from the server's).
    for (let i = -1; i <= days; i += 1) {
      const local = zonedParts(new Date(now.getTime() + i * DAY_MS), tz);
      if (local.weekday !== range.dayOfWeek) continue;
      for (let n = 0; n < range.maxSlots; n += 1) {
        const minutes = startMinutes + n * length;
        const start = zonedTimeToUtc(
          {
            year: local.year,
            month: local.month,
            day: local.day,
            hour: Math.floor(minutes / 60),
            minute: minutes % 60,
          },
          tz,
        );
        if (start.getTime() < earliest) continue;
        if (start.getTime() > now.getTime() + days * DAY_MS) continue;
        if (takenStarts.has(start.getTime())) continue;
        slots.push({ start, end: new Date(start.getTime() + length * 60000), timezone: tz });
      }
    }
  }

  const seen = new Set();
  return slots
    .sort((a, b) => a.start - b.start)
    .filter((s) => (seen.has(s.start.getTime()) ? false : seen.add(s.start.getTime())));
};

/** The slot starting exactly at `instant` (a Date), if it's bookable. */
export const findSlot = (ranges, instant, options) =>
  buildSlots(ranges, options).find((s) => s.start.getTime() === instant.getTime()) || null;
