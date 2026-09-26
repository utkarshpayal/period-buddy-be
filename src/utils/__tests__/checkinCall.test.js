import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCheckinBackfill,
  checkinDateKey,
  describePeriodTiming,
  weekdayOf,
} from '../checkinCall.js';

test('call date is IST, not server UTC', () => {
  // 20:00 UTC on the 1st is 01:30 IST on the 2nd.
  assert.equal(checkinDateKey(new Date('2026-09-01T20:00:00Z')), '2026-09-02');
  assert.equal(checkinDateKey(new Date('2026-09-01T10:00:00Z')), '2026-09-01');
});

test('weekday of a date key', () => {
  assert.equal(weekdayOf('2026-09-26'), 'Saturday');
});

test('period timing is spoken relative to the call date', () => {
  assert.equal(describePeriodTiming('2026-09-26', '2026-09-26'), 'expected today');
  assert.equal(describePeriodTiming('2026-09-27', '2026-09-26'), 'expected tomorrow');
  assert.equal(describePeriodTiming('2026-09-30', '2026-09-26'), 'expected in 4 days');
  assert.equal(
    describePeriodTiming('2026-09-25', '2026-09-26'),
    'was expected yesterday, about 1 day late',
  );
  assert.equal(
    describePeriodTiming('2026-09-20', '2026-09-26'),
    'was expected 6 days ago, about 6 days late',
  );
  assert.equal(describePeriodTiming(undefined, '2026-09-26'), '');
});

test('backfill keeps only discussed cycle fields when there is no log yet', () => {
  const payload = buildCheckinBackfill(
    {
      flow: 'light',
      mood: 'not_discussed',
      sleepHours: '7',
      symptoms: 'cramps, bloating',
      medication: 'none',
      stressLevel: '',
      call_summary: 'User has mild cramps',
      user_auth_token: 'secret',
    },
    null,
  );
  assert.deepEqual(payload, { flow: 'light', sleepHours: '7', symptoms: 'cramps, bloating' });
});

test("flow 'none' is a real value, not a placeholder", () => {
  assert.deepEqual(buildCheckinBackfill({ flow: 'none' }, null), { flow: 'none' });
});

test('backfill never overwrites what the agent or app already saved', () => {
  const existing = { flow: 'medium', mood: 'calm', symptoms: ['cramps'], note: '' };
  assert.deepEqual(buildCheckinBackfill({ flow: 'heavy', mood: 'sad' }, existing), {});
  assert.deepEqual(buildCheckinBackfill({ flow: 'heavy', sleepHours: '6' }, existing), {
    sleepHours: '6',
    symptoms: ['cramps'],
  });
});

test('backfill ignores a missing or malformed payload', () => {
  assert.deepEqual(buildCheckinBackfill(undefined, null), {});
  assert.deepEqual(buildCheckinBackfill('oops', null), {});
});
