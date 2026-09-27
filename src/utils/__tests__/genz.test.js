import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BADGE_CATALOG,
  buildEra,
  buildWrapped,
  computeBadges,
  computeLongestStreak,
  generateInviteCode,
  isEmojiLike,
  logMetrics,
  nextStreakMilestone,
  normalizeInviteCode,
  parseCircleInput,
  parseVibeInput,
  resolveWrappedRange,
  mergePhaseEras,
  parseEraInput,
} from '../genz.js';
import { DEFAULT_CYCLE_SYNC_TIPS, PHASE_ERAS } from '../../constants/cycleSync.js';

const log = (dateKey, extra = {}) => ({ dateKey, flow: 'none', ...extra });

test('longest streak counts consecutive days, ignoring duplicates and gaps', () => {
  assert.equal(computeLongestStreak([]), 0);
  assert.equal(computeLongestStreak(['2026-01-01']), 1);
  assert.equal(
    computeLongestStreak([
      '2026-01-01',
      '2026-01-02',
      '2026-01-02',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
    ]),
    3,
  );
  // Across a month boundary.
  assert.equal(computeLongestStreak(['2026-01-31', '2026-02-01', '2026-02-02']), 3);
});

test('next milestone is the first one above the streak', () => {
  assert.equal(nextStreakMilestone(0), 3);
  assert.equal(nextStreakMilestone(7), 14);
  assert.equal(nextStreakMilestone(365), null);
});

test('badges are earned at their target and progress is capped', () => {
  const badges = computeBadges({ totalLogs: 60, longestStreak: 8 });
  const byKey = Object.fromEntries(badges.map((b) => [b.key, b]));
  assert.equal(badges.length, BADGE_CATALOG.length);
  assert.equal(byKey.first_log.earned, true);
  assert.equal(byKey.logs_50.earned, true);
  assert.deepEqual(byKey.logs_50.progress, { current: 50, target: 50 });
  assert.equal(byKey.streak_7.earned, true);
  assert.equal(byKey.streak_30.earned, false);
  assert.deepEqual(byKey.streak_30.progress, { current: 8, target: 30 });
  assert.equal(byKey.squad.earned, false);
});

test('log metrics count cycles only once the next period has started', () => {
  const logs = [
    log('2026-01-01', { flow: 'heavy', mood: 'happy', waterIntake: 2500 }),
    log('2026-01-02', { flow: 'medium', sleepHours: 9 }),
    log('2026-01-29', { flow: 'light' }),
  ];
  const m = logMetrics(logs);
  assert.equal(m.totalLogs, 3);
  assert.equal(m.cyclesTracked, 1);
  assert.equal(m.moodDays, 1);
  assert.equal(m.hydratedDays, 1);
  assert.equal(m.restedDays, 1);
});

test('wrapped range resolves month and year, defaulting to the current one', () => {
  const today = new Date('2026-02-10T12:00:00Z');
  assert.deepEqual(resolveWrappedRange('month', '2024-02', today), {
    period: 'month',
    fromKey: '2024-02-01',
    toKey: '2024-02-29',
    label: 'February 2024',
  });
  assert.equal(resolveWrappedRange('month', 'garbage', today).fromKey, '2026-02-01');
  assert.equal(resolveWrappedRange('year', undefined, today).toKey, '2026-12-31');
  assert.equal(resolveWrappedRange('week', undefined, today), null);
});

test('wrapped summarises the range and picks a persona from the top mood', () => {
  const logs = [
    log('2025-12-05', { flow: 'heavy' }),
    log('2026-01-02', {
      flow: 'heavy',
      moods: ['tired', 'irritable'],
      symptoms: ['cramps'],
      sleepHours: 7,
    }),
    log('2026-01-03', {
      flow: 'medium',
      mood: 'tired',
      symptoms: ['cramps', 'bloating'],
      sleepHours: 9,
    }),
    log('2026-01-04', { mood: 'happy', stressLevel: 4 }),
    log('2026-01-20', { mood: 'tired' }),
  ];
  const range = resolveWrappedRange('month', '2026-01');
  const w = buildWrapped(logs, range, '2026-01-10');
  assert.equal(w.daysLogged, 4);
  assert.equal(w.daysInRange, 10);
  assert.equal(w.consistency, 40);
  assert.equal(w.longestStreak, 3);
  assert.equal(w.periodsStarted, 1);
  assert.equal(w.periodDays, 2);
  assert.equal(w.avgCycleLength, 28);
  assert.deepEqual(w.topMoods[0], { value: 'tired', count: 3 });
  assert.deepEqual(w.topSymptoms[0], { value: 'cramps', count: 2 });
  assert.equal(w.avgSleepHours, 8);
  assert.equal(w.persona.title, 'Professional Napper');
  assert.equal(w.isEmpty, false);
});

test('an empty wrapped is flagged and has no persona mood', () => {
  const w = buildWrapped([], resolveWrappedRange('month', '2026-03'), '2026-03-31');
  assert.equal(w.isEmpty, true);
  assert.equal(w.consistency, 0);
  assert.equal(w.persona.title, 'Mysterious Vibe');
});

test('era reports days left in the phase and groups that phase’s tips', () => {
  const era = buildEra(
    {
      currentCycleDay: 2,
      cycleLength: 28,
      periodLength: 5,
      currentPhase: 'period',
      nextPeriodDaysAway: 26,
    },
    DEFAULT_CYCLE_SYNC_TIPS,
  );
  assert.equal(era.phase, 'period');
  assert.equal(era.daysLeftInPhase, 3);
  assert.equal(era.nextPhase, 'follicular');
  assert.equal(era.era.name, PHASE_ERAS.period.name);
  assert.ok(era.tips.move.length > 0);
  assert.ok(era.tips.fuel.every((t) => t.title));
  // Only this phase's tips.
  const periodTitles = new Set(
    DEFAULT_CYCLE_SYNC_TIPS.filter((t) => t.phase === 'period').map((t) => t.title),
  );
  Object.values(era.tips)
    .flat()
    .forEach((t) => assert.ok(periodTitles.has(t.title)));
});

test('inactive tips are left out of the era', () => {
  const era = buildEra(
    { currentCycleDay: 20, cycleLength: 28, periodLength: 5, currentPhase: 'luteal' },
    [
      { phase: 'luteal', category: 'move', title: 'On', active: true, order: 1 },
      { phase: 'luteal', category: 'move', title: 'Off', active: false, order: 0 },
    ],
  );
  assert.deepEqual(
    era.tips.move.map((t) => t.title),
    ['On'],
  );
  assert.equal(era.daysLeftInPhase, 8);
});

test('invite codes avoid ambiguous characters and normalise user input', () => {
  for (let i = 0; i < 50; i += 1) assert.match(generateInviteCode(), /^[A-HJKMNP-Z2-9]{6}$/);
  assert.equal(normalizeInviteCode(' ab-c 12d '), 'ABC12D');
});

test('emoji check accepts emoji and rejects text', () => {
  assert.equal(isEmojiLike('🫶'), true);
  assert.equal(isEmojiLike('👩🏽‍💻'), true);
  assert.equal(isEmojiLike('hi'), false);
  assert.equal(isEmojiLike('🔥hi'), false);
  assert.equal(isEmojiLike(''), false);
});

test('vibe and circle input validation', () => {
  assert.ok(parseVibeInput({ emoji: 'x' }).error);
  assert.ok(parseVibeInput({ emoji: '🍫', text: 'a'.repeat(81) }).error);
  assert.deepEqual(
    parseVibeInput({ emoji: '🍫', text: ' send snacks ', askForSupport: true }).vibe,
    {
      emoji: '🍫',
      text: 'send snacks',
      sharePhase: false,
      askForSupport: true,
    },
  );
  assert.ok(parseCircleInput({ name: '' }).error);
  assert.ok(parseCircleInput({ name: 'x'.repeat(31) }).error);
  assert.deepEqual(parseCircleInput({ name: ' Girls ' }).circle, { name: 'Girls', emoji: '🫶' });
});

test('mergePhaseEras applies CMS overrides and keeps the rest of the defaults', () => {
  const eras = mergePhaseEras([
    { phase: 'period', name: 'Blanket Era', aura: ['#111111', '#222222'] },
  ]);
  assert.equal(eras.period.name, 'Blanket Era');
  assert.deepEqual(eras.period.aura, ['#111111', '#222222']);
  assert.equal(eras.period.emoji, '🧸');
  assert.equal(eras.period.statusEmoji, '🩸');
  assert.equal(eras.luteal.name, 'Soft Life Era');
});

test('parseEraInput needs a name, emoji, tagline and two 6-digit hex colours', () => {
  const ok = parseEraInput({
    name: ' Cozy ',
    emoji: '🧸',
    tagline: 'Rest.',
    aura: ['#ff6b8b', '#FFB3C1'],
  });
  assert.deepEqual(ok, {
    era: { name: 'Cozy', emoji: '🧸', tagline: 'Rest.', aura: ['#FF6B8B', '#FFB3C1'] },
  });
  assert.ok(parseEraInput({ emoji: '🧸', tagline: 'x', aura: ['#111111', '#222222'] }).error);
  assert.ok(
    parseEraInput({ name: 'A', emoji: '🧸', tagline: 'x', aura: ['#fff', '#222222'] }).error,
  );
  assert.ok(
    parseEraInput({ name: 'A', emoji: '🧸', tagline: 'x', aura: ['rgba(0,0,0,1)', '#222222'] })
      .error,
  );
  assert.ok(
    parseEraInput({ name: 'A'.repeat(31), emoji: '🧸', tagline: 'x', aura: ['#111111', '#222222'] })
      .error,
  );
});

test('buildEra uses the era cards it is given', () => {
  const eras = mergePhaseEras([
    { phase: 'period', name: 'Blanket Era' },
    { phase: 'follicular', name: 'Glow Up Era' },
  ]);
  const era = buildEra(
    {
      currentCycleDay: 2,
      cycleLength: 28,
      periodLength: 5,
      currentPhase: 'period',
      nextPeriodDaysAway: 26,
    },
    [],
    eras,
  );
  assert.equal(era.era.name, 'Blanket Era');
  assert.equal(era.nextEra.name, 'Glow Up Era');
});
