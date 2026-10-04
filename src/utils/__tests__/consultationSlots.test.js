import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidTimeZone, zonedParts, zonedTimeToUtc } from '../timezone.js';
import { buildSlots, findSlot, slotLengthFor, validateWeeklyRanges } from '../consultationSlots.js';

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
