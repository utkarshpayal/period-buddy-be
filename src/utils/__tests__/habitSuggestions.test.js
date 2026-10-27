import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CATEGORY_ICONS,
  CATEGORY_POINTS,
  AI_RETRY_AFTER_MS,
  HABIT_CATALOG,
  MAX_SUGGESTIONS,
  STORED_SUGGESTIONS,
  topUp,
  dismissedTitles,
  hasRecentLogs,
  isSuggestionKey,
  shouldRetryAi,
  visibleSuggestions,
  describeLogs,
  parseAiHabits,
  readSignals,
  suggestByRules,
} from '../habitSuggestions.js';

const TODAY = '2026-03-20';
const day = (n, extra = {}) => ({
  dateKey: `2026-03-${String(20 - n).padStart(2, '0')}`,
  ...extra,
});

test('signals: only the last 14 days count, future logs ignored', () => {
  const s = readSignals(
    [
      day(0, { symptoms: ['cramps'] }),
      day(13, { symptoms: ['cramps'] }),
      day(14, { symptoms: ['cramps'] }),
      { dateKey: '2026-03-21', symptoms: ['cramps'] },
    ],
    TODAY,
  );
  assert.equal(s.daysLogged, 2);
  assert.equal(s.symptomDays.cramps, 2);
});

test("signals: averages skip unlogged values; didn't exercise is not exercise", () => {
  const s = readSignals(
    [
      day(0, { sleepHours: 6, waterIntake: 1000, exercise: ['didnt-exercise'] }),
      day(1, { sleepHours: 5, stressLevel: 8, exercise: ['yoga'] }),
      day(2),
    ],
    TODAY,
  );
  assert.equal(s.avgSleep, 5.5);
  assert.equal(s.avgWater, 1000);
  assert.equal(s.avgStress, 8);
  assert.equal(s.exerciseDays, 1);
});

test('rules: repeated cramps put a warm compress first, with the reason', () => {
  const [first] = suggestByRules({
    logs: [0, 1, 2].map((n) => day(n, { symptoms: ['cramps'] })),
    todayKey: TODAY,
  });
  assert.equal(first.key, 'heat');
  assert.match(first.reason, /cramps on 3 days/);
  assert.equal(first.rewardPoints, CATEGORY_POINTS.care);
});

test('rules: log reasons beat phase ones', () => {
  const logs = [0, 1, 2, 3].map((n) => day(n, { sleepHours: 5, waterIntake: 750 }));
  const keys = suggestByRules({ logs, todayKey: TODAY, phase: 'follicular' }).map((s) => s.key);
  assert.deepEqual(keys.slice(0, 2).sort(), ['sleep', 'water']);
});

test('rules: nothing logged lately means no suggestions, not generic ones', () => {
  assert.deepEqual(
    suggestByRules({ logs: [], todayKey: TODAY, phase: 'luteal', goal: 'achieve_pregnancy' }),
    [],
  );
  // Logs older than the window don't count either.
  assert.deepEqual(
    suggestByRules({ logs: [day(20, { symptoms: ['cramps'] })], todayKey: TODAY }),
    [],
  );
});

test('rules: always 10 once anything is logged; log/phase/goal picks lead', () => {
  const list = suggestByRules({
    logs: [day(0, { flow: 'medium' })],
    todayKey: TODAY,
    phase: 'period',
    goal: 'achieve_pregnancy',
  });
  assert.equal(list.length, MAX_SUGGESTIONS);
  assert.deepEqual(
    list.slice(0, 3).map((s) => s.key),
    ['folate', 'iron', 'heat'],
  );
  assert.equal(new Set(list.map((s) => s.title)).size, list.length);
  assert.ok(new Set(list.map((s) => s.category)).size >= 4);
  assert.ok(list.every((s) => s.reason.length > 0));
});

test('top-up: phase habits come before others; goal-only habits need the goal', () => {
  const list = topUp([], { phase: 'luteal', limit: 5 });
  assert.ok(list.every((s) => HABIT_CATALOG[s.key].phases.includes('luteal')));
  const all = topUp([], { phase: 'period', limit: 30 }).map((s) => s.key);
  assert.ok(!all.includes('folate'));
  assert.ok(!all.includes('pelvicFloor'));
});

test('top-up: skips habits she has or avoided, and never repeats', () => {
  const list = topUp([], {
    phase: 'period',
    existingTitles: ['Eat Iron-Rich Food'],
    avoidTitles: ['warm compress for 15 minutes'],
    limit: STORED_SUGGESTIONS,
  });
  const keys = list.map((s) => s.key);
  assert.equal(list.length, STORED_SUGGESTIONS);
  assert.ok(!keys.includes('iron') && !keys.includes('heat'));
  assert.equal(new Set(keys).size, keys.length);
});

test('stored day: shows at most 10, the spares step in after a dismissal', () => {
  const stored = {
    dismissed: [],
    suggestions: topUp([], { phase: 'follicular', limit: STORED_SUGGESTIONS }),
  };
  const shown = visibleSuggestions(stored);
  assert.equal(shown.length, MAX_SUGGESTIONS);
  const after = visibleSuggestions({ ...stored, dismissed: [shown[0].key] });
  assert.equal(after.length, MAX_SUGGESTIONS);
  assert.equal(after[9].key, stored.suggestions[10].key);
});

test('hasRecentLogs: only logs inside the window count', () => {
  assert.equal(hasRecentLogs([day(0)], TODAY), true);
  assert.equal(hasRecentLogs([day(14)], TODAY), false);
  assert.equal(hasRecentLogs([], TODAY), false);
});

test('rules: habits already added are skipped, case-insensitively', () => {
  const keys = suggestByRules({
    logs: [0, 1, 2].map((n) => day(n, { symptoms: ['cramps'] })),
    todayKey: TODAY,
    existingTitles: ['warm compress for 15 minutes'],
  }).map((s) => s.key);
  assert.ok(!keys.includes('heat'));
});

test('ai output: fixes bad category/icon, trims, drops duplicates and existing habits', () => {
  const out = parseAiHabits(
    {
      habits: [
        {
          title: '  Drink a glass of warm water\n',
          reason: 'Bloating on 3 days',
          category: 'nutrition',
          icon: 'rocket',
        },
        { title: 'drink a glass of warm water', reason: 'dup', category: 'nutrition' },
        { title: 'Sleep 8 Hours', reason: 'already has it', category: 'sleep' },
        {
          title: 'Box breathing',
          reason: 'x'.repeat(200),
          category: 'spiritual',
          icon: 'leaf-outline',
        },
        { title: '', reason: 'empty' },
        'not an object',
      ],
    },
    ['Sleep 8 Hours'],
  );
  assert.deepEqual(
    out.map((s) => s.title),
    ['Drink a glass of warm water', 'Box breathing'],
  );
  assert.equal(out[0].icon, CATEGORY_ICONS.nutrition[0]);
  assert.equal(out[0].rewardPoints, CATEGORY_POINTS.nutrition);
  assert.equal(out[1].category, 'care');
  assert.ok(out[1].reason.length <= 90);
  assert.equal(out[0].key, 'drink-a-glass-of-warm-water');
});

test('ai output: anything but {habits: [...]} gives nothing', () => {
  assert.deepEqual(parseAiHabits(null), []);
  assert.deepEqual(parseAiHabits({ habits: 'no' }), []);
});

test('prompt lines: newest first, no notes', () => {
  const lines = describeLogs(
    [day(2, { flow: 'heavy', note: 'secret' }), day(0, { moods: ['sad'], sleepHours: 6 })],
    TODAY,
  );
  assert.deepEqual(lines, ['2026-03-20, mood: sad, sleep: 6h', '2026-03-18, flow: heavy']);
});

test('rules: habits dismissed or removed lately are never suggested', () => {
  const keys = suggestByRules({
    logs: [0, 1, 2].map((n) => day(n, { symptoms: ['cramps'] })),
    todayKey: TODAY,
    avoidTitles: ['Warm Compress for 15 Minutes'],
  }).map((s) => s.key);
  assert.ok(!keys.includes('heat'));
  assert.equal(keys[0], 'stretch');
});

test('retry: only a failed AI day, only when AI may run, only after the wait', () => {
  const now = Date.parse('2026-03-20T10:00:00Z');
  const failed = { aiFailed: true, attemptedAt: new Date(now - AI_RETRY_AFTER_MS) };
  assert.equal(shouldRetryAi(failed, { now, aiOk: true }), true);
  assert.equal(shouldRetryAi(failed, { now, aiOk: false }), false);
  assert.equal(
    shouldRetryAi({ ...failed, attemptedAt: new Date(now - 60_000) }, { now, aiOk: true }),
    false,
  );
  assert.equal(shouldRetryAi({ ...failed, aiFailed: false }, { now, aiOk: true }), false);
});

test('stored day: always 10; dismissed picks and habits she has are left out', () => {
  const stored = {
    dismissed: ['walk'],
    context: { phase: 'luteal' },
    suggestions: [
      { key: 'walk', title: 'Walk for 20 Minutes' },
      { key: 'water', title: 'Drink 8 Glasses of Water' },
      { key: 'sleep', title: 'Sleep 8 Hours' },
    ],
  };
  const shown = visibleSuggestions(stored, ['sleep 8 hours']);
  assert.equal(shown.length, MAX_SUGGESTIONS);
  assert.equal(shown[0].key, 'water');
  assert.ok(!shown.some((s) => s.key === 'walk' || s.key === 'sleep'));
  assert.equal(new Set(shown.map((s) => s.title)).size, MAX_SUGGESTIONS);
  // The live top-up suits the stored phase.
  assert.ok(HABIT_CATALOG[shown[1].key].phases.includes('luteal'));
  assert.deepEqual(dismissedTitles([stored, { suggestions: [], dismissed: [] }]), [
    'Walk for 20 Minutes',
  ]);
});

test('strict 10: avoided habits come back only when nothing else fits, log ones first', () => {
  const titles = Object.values(HABIT_CATALOG).map((h) => h.title);
  // She has all but 3 catalog habits and avoided everything else.
  const existingTitles = titles.slice(3);
  const avoidTitles = titles.slice(0, 3);
  const logs = [0, 1, 2].map((n) => day(n, { sleepHours: 5 }));
  const list = suggestByRules({ logs, todayKey: TODAY, existingTitles, avoidTitles, limit: 3 });
  assert.equal(list.length, 3);
  assert.equal(list[0].key, 'sleep'); // her logs point to it, so it returns first
  assert.match(list[0].reason, /5\.0 h of sleep/);
});

test('suggestion keys: slugs and catalog ids only', () => {
  assert.ok(isSuggestionKey('windDown'));
  assert.ok(isSuggestionKey('drink-a-glass-of-warm-water'));
  assert.ok(!isSuggestionKey('$where'));
  assert.ok(!isSuggestionKey(''));
  assert.ok(!isSuggestionKey('x'.repeat(61)));
});
