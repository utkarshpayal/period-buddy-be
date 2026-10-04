/**
 * Time zones without a dependency, on Node's built-in ICU (Intl).
 *
 * The one standard used across the API:
 * - An instant (a booked session, `Consultation.scheduledFor`) is stored as a
 *   UTC Date and sent as ISO 8601 (`2026-10-05T09:30:00.000Z`). Every client
 *   shows it in the viewer's own time zone.
 * - A recurring schedule (DoctorAvailability) is wall-clock "HH:MM" on a
 *   weekday in an IANA zone (`Asia/Kolkata`), the zone the doctor works in.
 */

/** Zone used when none is known: the app's users and doctors are in India. */
export const DEFAULT_TIME_ZONE = 'Asia/Kolkata';

/** Whether `tz` is an IANA zone name this runtime knows (e.g. "Asia/Kolkata"). */
export const isValidTimeZone = (tz) => {
  if (typeof tz !== 'string' || !tz.trim()) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const partsFormatter = new Map();
const formatterFor = (tz) => {
  if (!partsFormatter.has(tz)) {
    partsFormatter.set(
      tz,
      new Intl.DateTimeFormat('en-US', {
        timeZone: tz,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        weekday: 'short',
      }),
    );
  }
  return partsFormatter.get(tz);
};

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Wall-clock parts of `date` in `tz`: { year, month (1-12), day, hour, minute, weekday (0=Sun) }. */
export const zonedParts = (date, tz) => {
  const parts = Object.fromEntries(
    formatterFor(tz)
      .formatToParts(date)
      .map((p) => [p.type, p.value]),
  );
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS[parts.weekday],
  };
};

/** Offset of `tz` from UTC at `date`, in minutes (Asia/Kolkata → 330). */
const offsetMinutes = (date, tz) => {
  const p = zonedParts(date, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(date.getTime() / 1000) * 1000) / 60000);
};

/**
 * The UTC instant of wall-clock `year-month-day hour:minute` in `tz`.
 * Two passes settle the offset across a daylight-saving change.
 */
export const zonedTimeToUtc = ({ year, month, day, hour, minute }, tz) => {
  const guess = Date.UTC(year, month - 1, day, hour, minute);
  let instant = guess - offsetMinutes(new Date(guess), tz) * 60000;
  instant = guess - offsetMinutes(new Date(instant), tz) * 60000;
  return new Date(instant);
};

/** "HH:MM" → minutes from midnight, or null when malformed. */
export const parseHHMM = (value) => {
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(value || ''));
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};
