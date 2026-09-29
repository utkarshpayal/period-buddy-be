import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeUsage, tallyUsageEvents, usageDays } from '../featureUsage.js';

test('tallyUsageEvents counts opens and taps per known item and skips junk', () => {
  const tally = tallyUsageEvents({
    events: [
      { itemKey: 'blogs', kind: 'open' },
      { itemKey: 'blogs', kind: 'open' },
      { itemKey: 'blogs', kind: 'tap' },
      { itemKey: 'link:abc123', kind: 'tap' },
      { itemKey: 'notAFeature', kind: 'open' },
      { itemKey: 'blogs', kind: 'view' },
      null,
    ],
  });
  assert.deepEqual(Object.fromEntries(tally), {
    blogs: { opens: 2, taps: 1 },
    'link:abc123': { opens: 0, taps: 1 },
  });
  assert.equal(tallyUsageEvents({ events: 'x' }).size, 0);
  const many = { events: Array.from({ length: 80 }, () => ({ itemKey: 'forest', kind: 'open' })) };
  assert.equal(tallyUsageEvents(many).get('forest').opens, 50);
});

test('usageDays ends today, oldest first', () => {
  const days = usageDays(3, new Date('2026-09-29T10:00:00Z'));
  assert.deepEqual(days, ['2026-09-27', '2026-09-28', '2026-09-29']);
});

test('summarizeUsage totals rows, aligns daily to the range and adds devices', () => {
  const days = ['2026-09-28', '2026-09-29'];
  const items = summarizeUsage(
    [
      { itemKey: 'blogs', day: '2026-09-28', opens: 3, taps: 1 },
      { itemKey: 'blogs', day: '2026-09-29', opens: 2, taps: 0 },
      { itemKey: 'blogs', day: '2026-01-01', opens: 99, taps: 99 },
    ],
    { blogs: 4, forest: 1 },
    days,
  );
  assert.deepEqual(items, {
    blogs: {
      opens: 5,
      taps: 1,
      devices: 4,
      daily: [
        { opens: 3, taps: 1 },
        { opens: 2, taps: 0 },
      ],
    },
  });
});
