import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimeZone, zonedParts, zonedTimeToUtc } from '../timezone.js';
import {
  buildSlots,
  findSlot,
  isScheduledSlot,
  rangePlan,
  slotLengthFor,
  validateDateOverrides,
  validateWeeklyRanges,
} from '../consultationSlots.js';

test('IST wall clock converts to UTC', () => {
  const utc = zonedTimeToUtc({ year: 2026, month: 10, day: 5, hour: 9, minute: 0 }, 'Asia/Kolkata');
  assert.equal(utc.toISOString(), '2026-10-05T03:30:00.000Z');
});

test('daylight saving is respected (New York, summer vs winter)', () => {
  const summer = zonedTimeToUtc(
    { year: 2026, month: 7, day: 1, hour: 9, minute: 0 },
    'America/New_York',
  );
  const winter = zonedTimeToUtc(
    { year: 2026, month: 12, day: 1, hour: 9, minute: 0 },
    'America/New_York',
  );
  assert.equal(summer.toISOString(), '2026-07-01T13:00:00.000Z');
  assert.equal(winter.toISOString(), '2026-12-01T14:00:00.000Z');
});

test('zonedParts gives the local weekday', () => {
  // 2026-10-04T20:00Z is Monday 01:30 in India.
  const p = zonedParts(new Date('2026-10-04T20:00:00Z'), 'Asia/Kolkata');
  assert.equal(p.weekday, 1);
  assert.equal(p.hour, 1);
  assert.equal(p.minute, 30);
});

test('isValidTimeZone', () => {
  assert.equal(isValidTimeZone('Asia/Kolkata'), true);
  assert.equal(isValidTimeZone('Mars/Base'), false);
  assert.equal(isValidTimeZone(''), false);
});

test('a range is split into equal slots', () => {
  assert.equal(slotLengthFor('09:00', '12:00', 4), 45);
  assert.equal(slotLengthFor('09:00', '09:15', 2), null); // under 10 minutes
  assert.equal(slotLengthFor('12:00', '09:00', 1), null);
});

test('buildSlots: IST range on Monday, past slots and taken slots left out', () => {
  const ranges = [
    { dayOfWeek: 1, startTime: '09:00', endTime: '12:00', maxSlots: 4, timezone: 'Asia/Kolkata' },
  ];
  // Monday 5 Oct 2026, 10:00 IST
  const now = new Date('2026-10-05T04:30:00Z');
  const taken = new Set([new Date('2026-10-05T05:45:00Z').getTime()]); // 11:15 IST
  const slots = buildSlots(ranges, { now, days: 8, takenStarts: taken });
  const today = slots.filter((s) => s.start.toISOString().startsWith('2026-10-05'));
  // 09:00 and 09:45 have passed, 10:30 is 30 minutes away (bookable), 11:15 is taken.
  assert.deepEqual(
    today.map((s) => s.start.toISOString()),
    ['2026-10-05T05:00:00.000Z'],
  );
  // Next Monday has all four.
  assert.equal(slots.filter((s) => s.start.toISOString().startsWith('2026-10-12')).length, 4);
  assert.equal(slots[0].end - slots[0].start, 45 * 60000);
});

test('findSlot only matches a real slot start', () => {
  const ranges = [
    { dayOfWeek: 2, startTime: '10:00', endTime: '11:00', maxSlots: 2, timezone: 'Asia/Kolkata' },
  ];
  const now = new Date('2026-10-05T00:00:00Z');
  assert.ok(findSlot(ranges, new Date('2026-10-06T04:30:00Z'), { now })); // Tue 10:00 IST
  assert.ok(findSlot(ranges, new Date('2026-10-06T05:00:00Z'), { now })); // Tue 10:30 IST
  assert.equal(findSlot(ranges, new Date('2026-10-06T04:45:00Z'), { now }), null);
});

test('validateWeeklyRanges catches bad schedules', () => {
  const ok = {
    dayOfWeek: 1,
    startTime: '09:00',
    endTime: '12:00',
    maxSlots: 4,
    timezone: 'Asia/Kolkata',
  };
  assert.equal(validateWeeklyRanges([ok]), null);
  assert.match(validateWeeklyRanges([{ ...ok, maxSlots: -1 }]), /whole number/);
  assert.match(validateWeeklyRanges([{ ...ok, endTime: '08:00' }]), /end after/);
  assert.match(
    validateWeeklyRanges([ok, { ...ok, startTime: '11:00', endTime: '13:00' }]),
    /overlap/,
  );
  assert.match(validateWeeklyRanges([{ ...ok, timezone: 'Nowhere/City' }]), /time zone/);
  assert.match(
    validateWeeklyRanges([ok, { ...ok, dayOfWeek: 2, timezone: 'Europe/London' }]),
    /same time zone/,
  );
});

const MONDAY_IST = {
  dayOfWeek: 1,
  startTime: '09:00',
  endTime: '12:00',
  maxSlots: 4,
  timezone: 'Asia/Kolkata',
};
const onDate = (slots, date) => slots.filter((s) => s.start.toISOString().startsWith(date));

test('a day-off override removes that date only', () => {
  const now = new Date('2026-10-04T00:00:00Z'); // Sunday
  const overrides = [{ date: '2026-10-05', ranges: [], timezone: 'Asia/Kolkata' }];
  const slots = buildSlots([MONDAY_IST], { now, days: 10, overrides });
  assert.equal(onDate(slots, '2026-10-05').length, 0);
  assert.equal(onDate(slots, '2026-10-12').length, 4);
});

test('an override replaces the weekly hours, and can open a day with none', () => {
  const now = new Date('2026-10-04T00:00:00Z');
  const overrides = [
    {
      date: '2026-10-05',
      ranges: [{ startTime: '14:00', endTime: '15:00', maxSlots: 2 }],
      timezone: 'Asia/Kolkata',
    },
    {
      date: '2026-10-07', // a Wednesday, closed every week
      ranges: [{ startTime: '10:00', endTime: '11:00', maxSlots: 1 }],
      timezone: 'Asia/Kolkata',
    },
  ];
  const slots = buildSlots([MONDAY_IST], { now, days: 10, overrides });
  assert.deepEqual(
    onDate(slots, '2026-10-05').map((s) => s.start.toISOString()),
    ['2026-10-05T08:30:00.000Z', '2026-10-05T09:00:00.000Z'], // 14:00, 14:30 IST
  );
  assert.deepEqual(
    onDate(slots, '2026-10-07').map((s) => s.start.toISOString()),
    ['2026-10-07T04:30:00.000Z'],
  );
});

test('notice and window follow the options', () => {
  const now = new Date('2026-10-05T02:30:00Z'); // Monday 08:00 IST
  const sameDay = (opts) => onDate(buildSlots([MONDAY_IST], { now, ...opts }), '2026-10-05');
  assert.equal(sameDay({ leadMinutes: 15 }).length, 4);
  // Three hours' notice: only 11:15 is far enough out.
  assert.equal(sameDay({ leadMinutes: 180 }).length, 1);
  const short = buildSlots([MONDAY_IST], { now, days: 3 });
  assert.equal(onDate(short, '2026-10-12').length, 0);
});

test('isScheduledSlot ignores the window and notice', () => {
  const booked = new Date('2026-10-05T03:30:00Z'); // Mon 09:00 IST
  assert.equal(isScheduledSlot([MONDAY_IST], [], booked), true);
  const off = [{ date: '2026-10-05', ranges: [], timezone: 'Asia/Kolkata' }];
  assert.equal(isScheduledSlot([MONDAY_IST], off, booked), false);
});

test('validateDateOverrides catches bad overrides', () => {
  const range = { startTime: '09:00', endTime: '10:00', maxSlots: 2 };
  assert.equal(validateDateOverrides([{ date: '2026-10-05', ranges: [] }]), null);
  assert.equal(validateDateOverrides([{ date: '2026-10-05', ranges: [range] }]), null);
  assert.match(validateDateOverrides([{ date: '2026-02-30', ranges: [] }]), /YYYY-MM-DD/);
  assert.match(
    validateDateOverrides([
      { date: '2026-10-05', ranges: [] },
      { date: '2026-10-05', ranges: [] },
    ]),
    /twice/,
  );
  assert.match(
    validateDateOverrides([
      { date: '2026-10-05', ranges: [range, { ...range, startTime: '09:30', endTime: '11:00' }] },
    ]),
    /overlap/,
  );
  assert.match(
    validateDateOverrides([{ date: '2026-10-05', ranges: [{ ...range, maxSlots: 30 }] }]),
    /whole number/,
  );
});

test('a fixed consultation length cuts back-to-back slots', () => {
  assert.deepEqual(rangePlan({ startTime: '09:00', endTime: '12:00', slotMinutes: 30 }), {
    length: 30,
    count: 6,
  });
  // 09:00-10:50 at 30 min: three slots, the last 20 minutes left free.
  assert.deepEqual(rangePlan({ startTime: '09:00', endTime: '10:50', slotMinutes: 30 }), {
    length: 30,
    count: 3,
  });
  assert.equal(rangePlan({ startTime: '09:00', endTime: '09:20', slotMinutes: 30 }), null);
  // Without slotMinutes the older equal-split rule still applies.
  assert.deepEqual(rangePlan({ startTime: '09:00', endTime: '12:00', maxSlots: 4 }), {
    length: 45,
    count: 4,
  });

  const now = new Date('2026-10-04T00:00:00Z');
  const ranges = [{ ...MONDAY_IST, maxSlots: 1, slotMinutes: 60 }];
  const monday = onDate(buildSlots(ranges, { now, days: 3 }), '2026-10-05');
  assert.deepEqual(
    monday.map((s) => s.start.toISOString()),
    ['2026-10-05T03:30:00.000Z', '2026-10-05T04:30:00.000Z', '2026-10-05T05:30:00.000Z'],
  );
  assert.equal(monday[0].end - monday[0].start, 60 * 60000);
});

test('validateWeeklyRanges checks a fixed length fits', () => {
  const r = { dayOfWeek: 1, startTime: '09:00', endTime: '09:20', maxSlots: 1, slotMinutes: 30 };
  assert.match(validateWeeklyRanges([r]), /at least one consultation/);
  assert.equal(validateWeeklyRanges([{ ...r, endTime: '10:00' }]), null);
  assert.match(validateWeeklyRanges([{ ...r, endTime: '10:00', slotMinutes: 5 }]), /length/);
});
