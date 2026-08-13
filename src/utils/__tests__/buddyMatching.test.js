import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreBuddyCompatibility } from '../buddyMatching.js';

const settings = (cycleLength, periodLength = 5) => ({
  lastPeriodStartDate: new Date('2026-08-01T00:00:00.000Z'),
  cycleLength,
  periodLength,
});

test('score is symmetric: score(a,b) === score(b,a)', () => {
  const a = settings(28, 5);
  const b = settings(31, 6);
  assert.equal(
    scoreBuddyCompatibility(a, b).compatibility,
    scoreBuddyCompatibility(b, a).compatibility,
  );
});

test('identical cycles score higher than divergent ones', () => {
  const base = settings(28, 5);
  const identical = scoreBuddyCompatibility(base, settings(28, 5)).compatibility;
  const divergent = scoreBuddyCompatibility(base, settings(40, 9)).compatibility;
  assert.ok(identical > divergent, `${identical} should exceed ${divergent}`);
});

test('identical cycles are flagged as the same phase', () => {
  const result = scoreBuddyCompatibility(settings(28, 5), settings(28, 5));
  assert.equal(result.samePhase, true);
});

test('compatibility is always clamped to [55, 99]', () => {
  const extreme = scoreBuddyCompatibility(settings(20, 1), settings(45, 10));
  assert.ok(extreme.compatibility >= 55 && extreme.compatibility <= 99);
});

test('missing settings still yields a valid, non-zero card', () => {
  const result = scoreBuddyCompatibility(null, null);
  assert.ok(result.compatibility >= 55 && result.compatibility <= 99);
  assert.ok(Array.isArray(result.similarities) && result.similarities.length === 3);
});

test('cycleOverlapDays shrinks as cycle-length gap grows', () => {
  const close = scoreBuddyCompatibility(settings(28), settings(29)).cycleOverlapDays;
  const far = scoreBuddyCompatibility(settings(28), settings(38)).cycleOverlapDays;
  assert.ok(close > far);
});
