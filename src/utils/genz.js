/**
 * Gen Z pack — pure logic behind Cycle Wrapped, the Phase Era card, streak
 * badges and Bestie Circles. No database access here, so it's unit-tested in
 * __tests__/genz.test.js; the controllers only load data and call these.
 */
import { randomInt } from 'node:crypto';
import { getCyclePhase, derivePeriodEpisodes, computeCycleLengths } from './cycle.js';
import { dateFromDateKey } from './apiHelpers.js';
import { CYCLE_SYNC_CATEGORIES, PHASE_ERAS } from '../constants/cycleSync.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/* --------------------------------- Streaks -------------------------------- */

export const STREAK_MILESTONES = [3, 7, 14, 30, 60, 100, 180, 365];

/** Longest run of consecutive logged days in a list of 'YYYY-MM-DD' keys. */
export const computeLongestStreak = (dateKeys = []) => {
  const days = [...new Set(dateKeys)].sort().map((key) => dateFromDateKey(key).getTime());
  let longest = 0;
  let run = 0;
  days.forEach((t, i) => {
    run = i > 0 && t - days[i - 1] === DAY_MS ? run + 1 : 1;
    longest = Math.max(longest, run);
  });
  return longest;
};

/** The next milestone above `streak` (null once past the last one). */
export const nextStreakMilestone = (streak = 0) =>
  STREAK_MILESTONES.find((m) => m > streak) ?? null;

/* --------------------------------- Badges --------------------------------- */

/**
 * Every badge the app can show. Each one is earned when `metrics[metric]`
 * reaches `target`, so adding a badge is one row here (plus the metric in
 * genzController#loadBadgeMetrics if it's new).
 */
export const BADGE_CATALOG = [
  {
    key: 'first_log',
    emoji: '🩸',
    title: 'First Drop',
    description: 'Logged your first day',
    metric: 'totalLogs',
    target: 1,
  },
  {
    key: 'streak_3',
    emoji: '🔥',
    title: 'On a Roll',
    description: '3-day logging streak',
    metric: 'longestStreak',
    target: 3,
  },
  {
    key: 'streak_7',
    emoji: '💅',
    title: 'Week Slay',
    description: '7-day logging streak',
    metric: 'longestStreak',
    target: 7,
  },
  {
    key: 'streak_30',
    emoji: '💎',
    title: 'Built Different',
    description: '30-day logging streak',
    metric: 'longestStreak',
    target: 30,
  },
  {
    key: 'streak_100',
    emoji: '👑',
    title: 'Legend Status',
    description: '100-day logging streak',
    metric: 'longestStreak',
    target: 100,
  },
  {
    key: 'logs_50',
    emoji: '📊',
    title: 'Data Queen',
    description: 'Logged 50 days',
    metric: 'totalLogs',
    target: 50,
  },
  {
    key: 'logs_365',
    emoji: '🗓️',
    title: 'Year of Me',
    description: 'Logged 365 days',
    metric: 'totalLogs',
    target: 365,
  },
  {
    key: 'full_cycle',
    emoji: '🌕',
    title: 'Full Circle',
    description: 'Tracked a complete cycle',
    metric: 'cyclesTracked',
    target: 1,
  },
  {
    key: 'cycles_6',
    emoji: '🔮',
    title: 'Pattern Pro',
    description: 'Tracked 6 cycles',
    metric: 'cyclesTracked',
    target: 6,
  },
  {
    key: 'feelings',
    emoji: '💭',
    title: 'Feelings Journal',
    description: 'Logged your mood on 20 days',
    metric: 'moodDays',
    target: 20,
  },
  {
    key: 'hydrated',
    emoji: '💧',
    title: 'Hydro Homie',
    description: '2L+ of water on 10 days',
    metric: 'hydratedDays',
    target: 10,
  },
  {
    key: 'sleep',
    emoji: '😴',
    title: 'Sleep Is Self-Care',
    description: '8h+ of sleep on 10 days',
    metric: 'restedDays',
    target: 10,
  },
  {
    key: 'habits',
    emoji: '✅',
    title: 'Habit Stacker',
    description: 'Completed 10 habits',
    metric: 'habitCompletions',
    target: 10,
  },
  {
    key: 'tea',
    emoji: '☕',
    title: 'Spilled the Tea',
    description: 'Posted in the community',
    metric: 'communityPosts',
    target: 1,
  },
  {
    key: 'squad',
    emoji: '🫶',
    title: 'Squad Up',
    description: 'Joined a Bestie Circle',
    metric: 'circles',
    target: 1,
  },
];

/** Badge list with earned/progress for the given metrics, earned first. */
export const computeBadges = (metrics = {}) =>
  BADGE_CATALOG.map(({ metric, target, ...badge }) => {
    const current = Math.max(0, Number(metrics[metric]) || 0);
    return {
      ...badge,
      earned: current >= target,
      progress: { current: Math.min(current, target), target },
    };
  });

/** Metrics that come straight from cycle logs. */
export const logMetrics = (logs = []) => {
  const dateKeys = logs.map((l) => l.dateKey);
  const episodes = derivePeriodEpisodes(logs);
  return {
    totalLogs: new Set(dateKeys).size,
    longestStreak: computeLongestStreak(dateKeys),
    // A cycle is "tracked" once the next period has started after it.
    cyclesTracked: Math.max(0, episodes.length - 1),
    moodDays: logs.filter((l) => l.mood || l.moods?.length).length,
    hydratedDays: logs.filter((l) => (l.waterIntake ?? 0) >= 2000).length,
    restedDays: logs.filter((l) => (l.sleepHours ?? 0) >= 8).length,
  };
};

/* --------------------------------- Wrapped -------------------------------- */

const MOOD_PERSONAS = {
  happy: { title: 'Sunshine Main Character', emoji: '☀️' },
  calm: { title: 'Zen Queen', emoji: '🧘' },
  energetic: { title: 'Hot Girl Walk Energy', emoji: '⚡' },
  frisky: { title: 'Flirty & Thriving', emoji: '😏' },
  anxious: { title: 'Overthinker, But Make It Cute', emoji: '🌀' },
  obsessive: { title: 'Overthinker, But Make It Cute', emoji: '🌀' },
  confused: { title: 'Plot Twist Enthusiast', emoji: '🤔' },
  sad: { title: 'In My Feels Era', emoji: '🥺' },
  depressed: { title: 'In My Feels Era', emoji: '🥺' },
  guilty: { title: 'Soft-Hearted Softie', emoji: '🫠' },
  selfCritical: { title: 'Soft-Hearted Softie', emoji: '🫠' },
  irritable: { title: "Don't Talk To Me Before Snacks", emoji: '😤' },
  tired: { title: 'Professional Napper', emoji: '😴' },
  lowEnergy: { title: 'Professional Napper', emoji: '😴' },
  apathetic: { title: 'Unbothered Icon', emoji: '😶‍🌫️' },
  neutral: { title: 'Unbothered Icon', emoji: '😶‍🌫️' },
  emotional: { title: 'Emotional Rollercoaster Rider', emoji: '🎢' },
  moodSwings: { title: 'Emotional Rollercoaster Rider', emoji: '🎢' },
};
const DEFAULT_PERSONA = { title: 'Mysterious Vibe', emoji: '🔮' };

const topCounts = (values, limit = 3) => {
  const counts = new Map();
  values.forEach((v) => v && counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, limit)
    .map(([value, count]) => ({ value, count }));
};

const average = (values) => {
  const nums = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
  if (!nums.length) return null;
  return Math.round((nums.reduce((s, v) => s + v, 0) / nums.length) * 10) / 10;
};

/**
 * Resolve a Wrapped range. `period` is 'month' (value 'YYYY-MM') or 'year'
 * (value 'YYYY'); anything missing or malformed means "the current one".
 * Returns inclusive date keys and a display label, or null if invalid.
 */
export const resolveWrappedRange = (period = 'month', value, today = new Date()) => {
  const year = today.getUTCFullYear();
  const pad = (n) => String(n).padStart(2, '0');
  if (period === 'year') {
    const y = value && /^\d{4}$/.test(value) ? Number(value) : year;
    return { period, fromKey: `${y}-01-01`, toKey: `${y}-12-31`, label: String(y) };
  }
  if (period !== 'month') return null;
  const [y, m] =
    value && /^\d{4}-(0[1-9]|1[0-2])$/.test(value)
      ? value.split('-').map(Number)
      : [year, today.getUTCMonth() + 1];
  const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const label = new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString('en-US', {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  return { period, fromKey: `${y}-${pad(m)}-01`, toKey: `${y}-${pad(m)}-${pad(lastDay)}`, label };
};

/**
 * Wrapped stats for logs inside [fromKey, toKey]. `allLogs` is the user's
 * history (cycle lengths need the period that started before the range).
 * `todayKey` caps "days in range" so a month in progress isn't under-scored.
 */
export const buildWrapped = (allLogs = [], { fromKey, toKey, label, period }, todayKey) => {
  const logs = allLogs.filter((l) => l.dateKey >= fromKey && l.dateKey <= toKey);
  const endKey = todayKey && todayKey < toKey ? todayKey : toKey;
  const daysInRange =
    endKey < fromKey
      ? 0
      : Math.round((dateFromDateKey(endKey) - dateFromDateKey(fromKey)) / DAY_MS) + 1;

  const moods = logs.flatMap((l) => (l.moods?.length ? l.moods : l.mood ? [l.mood] : []));
  const topMoods = topCounts(moods);
  const persona = MOOD_PERSONAS[topMoods[0]?.value] ?? DEFAULT_PERSONA;

  const episodes = derivePeriodEpisodes(allLogs);
  const lengths = computeCycleLengths(episodes);
  // Cycle lengths whose *ending* period start falls in the range.
  const inRangeLengths = lengths.filter((_, i) => {
    const endStart = episodes[i + 1]?.startKey;
    return endStart && endStart >= fromKey && endStart <= toKey;
  });
  const periodsStarted = episodes.filter((e) => e.startKey >= fromKey && e.startKey <= toKey);

  const dateKeys = logs.map((l) => l.dateKey);
  const daysLogged = new Set(dateKeys).size;

  return {
    period,
    label,
    fromKey,
    toKey,
    daysLogged,
    daysInRange,
    consistency: daysInRange ? Math.min(100, Math.round((daysLogged / daysInRange) * 100)) : 0,
    longestStreak: computeLongestStreak(dateKeys),
    periodsStarted: periodsStarted.length,
    periodDays: logs.filter((l) => l.flow && l.flow !== 'none').length,
    avgCycleLength: average(inRangeLengths),
    topMoods,
    topSymptoms: topCounts(logs.flatMap((l) => l.symptoms ?? [])),
    flowBreakdown: topCounts(
      logs.map((l) => l.flow).filter((f) => f && f !== 'none'),
      5,
    ),
    avgSleepHours: average(logs.map((l) => l.sleepHours)),
    avgWaterMl: average(logs.map((l) => l.waterIntake)),
    avgStress: average(logs.map((l) => l.stressLevel)),
    persona,
    isEmpty: daysLogged === 0,
  };
};

/* ---------------------------------- Era ----------------------------------- */

const NEXT_PHASE = {
  period: 'follicular',
  follicular: 'ovulation',
  ovulation: 'luteal',
  luteal: 'period',
};

/**
 * Today's era from a computeCyclePredictions() result, plus the tips for that
 * phase grouped by category. `tips` is the active tip list (DB or defaults).
 */
export const buildEra = (predictions, tips = []) => {
  const cycleDay = predictions.currentCycleDay;
  const cycleLength = predictions.cycleLength;
  const periodLength = predictions.periodLength;
  const phase = predictions.currentPhase;

  let daysLeft = 0;
  for (let d = cycleDay + 1; d <= cycleLength; d += 1) {
    if (getCyclePhase(d, periodLength, cycleLength) !== phase) break;
    daysLeft += 1;
  }

  const byCategory = Object.fromEntries(CYCLE_SYNC_CATEGORIES.map((c) => [c, []]));
  tips
    .filter((t) => t.phase === phase && t.active !== false && byCategory[t.category])
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .forEach((t) =>
      byCategory[t.category].push({
        id: t._id ? String(t._id) : undefined,
        emoji: t.emoji || '',
        title: t.title,
        body: t.body || '',
      }),
    );

  const nextPhase = NEXT_PHASE[phase];
  return {
    phase,
    cycleDay,
    cycleLength,
    daysLeftInPhase: daysLeft,
    nextPhase,
    nextEra: { name: PHASE_ERAS[nextPhase].name, emoji: PHASE_ERAS[nextPhase].emoji },
    nextPeriodDaysAway: predictions.nextPeriodDaysAway,
    isEstimate: Boolean(predictions.isEstimate),
    era: PHASE_ERAS[phase],
    tips: byCategory,
  };
};

/* --------------------------------- Circles -------------------------------- */

export const CIRCLE_LIMITS = {
  maxMembers: 8,
  maxCirclesPerUser: 5,
  nameMaxLength: 30,
  vibeMaxLength: 80,
  // One hype per sender → member per this window, so it can't become spam.
  hypeCooldownMs: 6 * 60 * 60 * 1000,
};

export const CIRCLE_REACTIONS = ['🫶', '🔥', '😭', '💅', '🍫', '🫂'];

// No 0/O/1/I/L so a code read out loud can't be mistyped.
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const generateInviteCode = (length = 6) =>
  Array.from({ length }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');

export const normalizeInviteCode = (code) =>
  String(code ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

/** A short emoji (or emoji sequence), not arbitrary text. */
export const isEmojiLike = (value) => {
  const s = String(value ?? '').trim();
  return (
    s.length > 0 && s.length <= 16 && /\p{Extended_Pictographic}/u.test(s) && !/[A-Za-z0-9]/.test(s)
  );
};

/** Validate a new vibe post. Returns { vibe } or { error }. */
export const parseVibeInput = (body = {}) => {
  const emoji = String(body.emoji ?? '').trim();
  if (!isEmojiLike(emoji)) return { error: 'Pick an emoji for your vibe' };
  const text = String(body.text ?? '').trim();
  if (text.length > CIRCLE_LIMITS.vibeMaxLength) {
    return { error: `Keep it under ${CIRCLE_LIMITS.vibeMaxLength} characters` };
  }
  return {
    vibe: {
      emoji,
      text,
      sharePhase: body.sharePhase === true,
      askForSupport: body.askForSupport === true,
    },
  };
};

/** Validate circle create/rename input. Returns { circle } or { error }. */
export const parseCircleInput = (body = {}) => {
  const name = String(body.name ?? '').trim();
  if (!name) return { error: 'Give your circle a name' };
  if (name.length > CIRCLE_LIMITS.nameMaxLength) {
    return { error: `Names are ${CIRCLE_LIMITS.nameMaxLength} characters max` };
  }
  const emoji = String(body.emoji ?? '').trim() || '🫶';
  if (!isEmojiLike(emoji)) return { error: 'The circle icon must be an emoji' };
  return { circle: { name, emoji } };
};
