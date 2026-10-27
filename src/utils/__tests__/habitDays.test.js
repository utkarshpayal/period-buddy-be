import test from 'node:test';
import assert from 'node:assert/strict';
import { habitStreak, habitWeek } from '../habitDays.js';

const TODAY = '2026-03-01';

test('streak counts back from today when it is ticked', () => {
  assert.equal(habitStreak(['2026-03-01', '2026-02-28', '2026-02-27'], TODAY), 3);
});

test('an unticked today keeps yesterday’s streak instead of showing 0', () => {
  assert.equal(habitStreak(['2026-02-28', '2026-02-27'], TODAY), 2);
});

test('a missed yesterday breaks the streak', () => {
  assert.equal(habitStreak(['2026-02-27', '2026-02-26'], TODAY), 0);
  assert.equal(habitStreak([], TODAY), 0);
});

test('gaps stop the count; duplicates are ignored', () => {
  assert.equal(habitStreak(['2026-03-01', '2026-03-01', '2026-02-28', '2026-02-26'], TODAY), 2);
});

test('week: the last 7 local days, oldest first, ending today', () => {
  const week = habitWeek(['2026-03-01', '2026-02-27', '2026-02-20'], TODAY);
  assert.deepEqual(
    week.map((d) => d.dateKey),
    [
      '2026-02-23',
      '2026-02-24',
      '2026-02-25',
      '2026-02-26',
      '2026-02-27',
      '2026-02-28',
      '2026-03-01',
    ],
  );
  assert.deepEqual(
    week.map((d) => d.done),
    [false, false, false, false, true, false, true],
  );
});
