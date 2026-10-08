import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePeriodAnchor, computeCyclePredictions } from '../cycle.js';
import { clientToday, clientTodayKey, dateFromDateKey } from '../apiHelpers.js';

const settings = { lastPeriodStartDate: '2026-09-10', cycleLength: 28, periodLength: 5 };
const september = [
  { dateKey: '2026-09-10', flow: 'medium' },
  { dateKey: '2026-09-11', flow: 'medium' },
];
const reqWith = (offset) => ({
  get: (h) => (h === 'X-Timezone-Offset' ? offset : undefined),
  query: {},
  body: {},
});

test("clientTodayKey: the phone's local date, not server UTC", () => {
  const now = new Date('2026-10-08T19:30:00Z'); // 01:00 on Oct 9 in India
  assert.equal(clientTodayKey(reqWith('-330'), now), '2026-10-09');
  assert.equal(clientTodayKey(reqWith('240'), now), '2026-10-08'); // 15:30 in New York
  assert.equal(clientTodayKey(reqWith(undefined), now), '2026-10-08', 'no header → UTC');
  assert.equal(clientTodayKey(reqWith('abc'), now), '2026-10-08', 'junk → UTC');
  assert.equal(clientTodayKey(reqWith('5000'), now), '2026-10-08', 'out of range → UTC');
  assert.equal(
    clientTodayKey({ get: () => undefined, query: { timezoneOffsetMinutes: '-330' } }, now),
    '2026-10-09',
  );
});

test('a period logged just after local midnight starts the new cycle at day 1', () => {
  const now = new Date('2026-10-08T19:30:00Z');
  const logs = [...september, { dateKey: '2026-10-09', flow: 'medium' }];
  const p = computeCyclePredictions(settings, logs, { today: clientToday(reqWith('-330'), now) });
  assert.equal(p.currentCycleDay, 1);
  assert.equal(p.currentPhase, 'period');
  assert.equal(p.nextPeriodDateKey, '2026-11-06');
  assert.equal(p.nextPeriodDaysAway, 28);
});

test('a newer last-period date from Cycle Settings moves the anchor', () => {
  const today = dateFromDateKey('2026-10-08');
  const p = computeCyclePredictions({ ...settings, lastPeriodStartDate: '2026-10-05' }, september, {
    today,
  });
  assert.equal(p.currentCycleDay, 4);
  assert.equal(p.nextPeriodDateKey, '2026-11-02');
});

test('choosePeriodAnchor: logged period wins unless the configured date is clearly newer', () => {
  const ep = { startKey: '2026-10-05', endKey: '2026-10-09' };
  const today = dateFromDateKey('2026-10-20');
  const key = (d) => d.toISOString().slice(0, 10);
  assert.equal(key(choosePeriodAnchor(ep, '2026-10-07', today)), '2026-10-05', 'inside the period');
  assert.equal(
    key(choosePeriodAnchor(ep, '2026-10-11', today)),
    '2026-10-05',
    'would still join it',
  );
  assert.equal(key(choosePeriodAnchor(ep, '2026-09-01', today)), '2026-10-05', 'older');
  assert.equal(
    key(choosePeriodAnchor(ep, '2026-10-15', today)),
    '2026-10-15',
    'newer, unlogged period',
  );
  assert.equal(
    key(choosePeriodAnchor(ep, '2026-11-01', today)),
    '2026-10-05',
    'future date ignored',
  );
  assert.equal(
    key(choosePeriodAnchor(null, '2026-10-01', today)),
    '2026-10-01',
    'no logs → configured',
  );
});
