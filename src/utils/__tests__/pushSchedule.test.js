import test from 'node:test';
import assert from 'node:assert/strict';
import { nextOccurrence, parseScheduleInput, describeSchedule } from '../pushSchedule.js';

// 09:00 IST on Monday 2026-09-28 is 03:30 UTC.
const START = new Date('2026-09-28T03:30:00Z');
const iso = (d) => (d ? d.toISOString() : null);

test('one-time schedule fires once, at startAt', () => {
  const s = { startAt: START, repeat: 'none' };
  assert.equal(iso(nextOccurrence(s, new Date('2026-09-27T00:00:00Z'))), iso(START));
  assert.equal(nextOccurrence({ ...s, runCount: 1 }, new Date('2026-09-27T00:00:00Z')), null);
  assert.equal(nextOccurrence(s, START), null);
});

test('daily keeps the time of day and honours the interval', () => {
  const s = { startAt: START, repeat: 'daily', interval: 1 };
  assert.equal(iso(nextOccurrence(s, START)), '2026-09-29T03:30:00.000Z');
  assert.equal(
    iso(nextOccurrence(s, new Date('2026-10-05T04:00:00Z'))),
    '2026-10-06T03:30:00.000Z',
  );
  const every3 = { ...s, interval: 3 };
  assert.equal(iso(nextOccurrence(every3, START)), '2026-10-01T03:30:00.000Z');
});

test('weekly on several IST weekdays, every 2 weeks', () => {
  // Mon + Thu, every other week, anchored to the start's week.
  const s = { startAt: START, repeat: 'weekly', interval: 2, daysOfWeek: [1, 4] };
  assert.equal(iso(nextOccurrence(s, START)), '2026-10-01T03:30:00.000Z'); // Thu same week
  assert.equal(
    iso(nextOccurrence(s, new Date('2026-10-01T03:30:00Z'))),
    '2026-10-12T03:30:00.000Z', // skips the off week
  );
});

test('weekly weekday is read in IST, not UTC', () => {
  // 01:00 IST Tuesday = 19:30 UTC Monday; "Tuesdays" must mean the IST day.
  const start = new Date('2026-09-28T19:30:00Z');
  const s = { startAt: start, repeat: 'weekly', daysOfWeek: [2] };
  assert.equal(iso(nextOccurrence(s, start)), '2026-10-05T19:30:00.000Z');
});

test('monthly on the 31st falls back to the last day of shorter months', () => {
  const start = new Date('2027-01-31T03:30:00Z');
  const s = { startAt: start, repeat: 'monthly' };
  assert.equal(iso(nextOccurrence(s, start)), '2027-02-28T03:30:00.000Z');
  assert.equal(
    iso(nextOccurrence(s, new Date('2027-02-28T03:30:00Z'))),
    '2027-03-31T03:30:00.000Z',
  );
});

test('endAt and maxRuns stop the series', () => {
  const s = { startAt: START, repeat: 'daily', endAt: new Date('2026-09-30T00:00:00Z') };
  assert.equal(iso(nextOccurrence(s, START)), '2026-09-29T03:30:00.000Z');
  assert.equal(nextOccurrence(s, new Date('2026-09-29T03:30:00Z')), null);
  assert.equal(
    nextOccurrence({ startAt: START, repeat: 'daily', maxRuns: 2, runCount: 2 }, START),
    null,
  );
});

test('parseScheduleInput validates and normalizes', () => {
  const now = new Date('2026-09-27T00:00:00Z');
  assert.ok(parseScheduleInput({}, now).error);
  assert.ok(parseScheduleInput({ startAt: '2026-09-01T00:00:00Z' }, now).error);
  assert.ok(parseScheduleInput({ startAt: START, repeat: 'hourly' }, now).error);
  assert.ok(parseScheduleInput({ startAt: START, repeat: 'daily', interval: 0 }, now).error);
  assert.ok(parseScheduleInput({ startAt: START, repeat: 'daily', endAt: START }, now).error);

  const weekly = parseScheduleInput({ startAt: START, repeat: 'weekly', daysOfWeek: [] }, now);
  assert.deepEqual(weekly.schedule.daysOfWeek, [1]); // defaults to the start's IST weekday

  const once = parseScheduleInput({ startAt: START, repeat: 'none', maxRuns: 5 }, now);
  assert.equal(once.schedule.maxRuns, null);
});

test('describeSchedule reads naturally', () => {
  assert.equal(describeSchedule({ startAt: START, repeat: 'daily' }), 'Daily at 09:00 IST');
  assert.equal(
    describeSchedule({ startAt: START, repeat: 'weekly', interval: 2, daysOfWeek: [1, 4] }),
    'Every 2 weeks on Mon, Thu at 09:00 IST',
  );
  assert.equal(
    describeSchedule({ startAt: START, repeat: 'none' }),
    'Once on 2026-09-28 at 09:00 IST',
  );
});
