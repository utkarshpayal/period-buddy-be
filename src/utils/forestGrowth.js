// Forest growth: one tree grows from a seed through GROWTH_STAGES as the user
// does their daily care tasks, then joins their forest and a new seed starts.
// Everything is derived from existing logs on each request (cycle logs, habit
// completions, forest waterings), so there is no stored growth state to
// backfill or drift. Pure and unit-tested; the controller only gathers dates.

export const DAILY_TASKS = ['log', 'habit', 'water'];

/** Care points a tree needs to be fully grown (one point per task per day). */
export const POINTS_PER_TREE = 60;

export const GROWTH_STAGES = [
  { key: 'seed', at: 0 },
  { key: 'sprout', at: 3 },
  { key: 'seedling', at: 8 },
  { key: 'sapling', at: 16 },
  { key: 'young', at: 27 },
  { key: 'mature', at: 40 },
  { key: 'bloom', at: 52 },
];

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

const keyToDay = (key) => Math.round(Date.parse(`${key}T00:00:00Z`) / DAY_MS);
const dayToKey = (day) => new Date(day * DAY_MS).toISOString().slice(0, 10);

export const shiftDateKey = (key, days) => dayToKey(keyToDay(key) + days);

// Bookkeeping fields, not something the user logged.
const META_FIELDS = new Set([
  '_id',
  'id',
  'userId',
  'dateKey',
  'rewardPoints',
  'createdAt',
  'updatedAt',
  '__v',
]);

const isFilled = (value) => {
  if (value === null || value === undefined || value === false) return false;
  if (typeof value === 'string') return value.trim() !== '' && value !== 'none';
  if (Array.isArray(value)) return value.some(isFilled);
  if (typeof value === 'number') return value > 0;
  if (typeof value === 'object') return Object.values(value).some(isFilled);
  return true;
};

/** Whether a cycle log actually records something (not an empty upsert). */
export const hasCycleEntry = (log) =>
  Boolean(log) &&
  Object.entries(log).some(([field, value]) => !META_FIELDS.has(field) && isFilled(value));

/**
 * Builds `dateKey -> Set(task)` from the three sources. Each source is a list
 * of date keys; invalid keys are ignored.
 */
export const buildTaskDays = ({ logDates = [], habitDates = [], waterDates = [] }) => {
  const days = new Map();
  const add = (keys, task) => {
    for (const key of keys) {
      if (typeof key !== 'string' || !DATE_KEY.test(key)) continue;
      if (!days.has(key)) days.set(key, new Set());
      days.get(key).add(task);
    }
  };
  add(logDates, 'log');
  add(habitDates, 'habit');
  add(waterDates, 'water');
  return days;
};

const stageFor = (points) => {
  let index = 0;
  GROWTH_STAGES.forEach((stage, i) => {
    if (points >= stage.at) index = i;
  });
  return index;
};

const vitalityFor = (daysSinceActive, doneToday) => {
  if (daysSinceActive === null) return { state: 'new', level: 80 };
  if (daysSinceActive === 0) return { state: 'thriving', level: 70 + doneToday * 10 };
  if (daysSinceActive === 1) return { state: 'thirsty', level: 60 };
  if (daysSinceActive <= 3) return { state: 'wilting', level: 40 };
  return { state: 'dry', level: 20 };
};

/**
 * The growth summary for `today` (a YYYY-MM-DD key). Days after `today` are
 * ignored, so a log dated ahead by a timezone can't grow the tree early.
 */
export const computeForestGrowth = (taskDays, today) => {
  const todayDay = keyToDay(today);
  const days = [...taskDays.entries()]
    .map(([key, tasks]) => ({ key, day: keyToDay(key), count: Math.min(tasks.size, 3) }))
    .filter((d) => d.day <= todayDay && d.count > 0)
    .sort((a, b) => a.day - b.day);

  let total = 0;
  const grownTrees = [];
  for (const d of days) {
    const before = total;
    total += d.count;
    for (
      let n = Math.floor(before / POINTS_PER_TREE) + 1;
      n <= Math.floor(total / POINTS_PER_TREE);
      n += 1
    ) {
      grownTrees.push({ number: n, grownOn: d.key });
    }
  }

  const points = total % POINTS_PER_TREE;
  const stageIndex = stageFor(points);
  const stage = GROWTH_STAGES[stageIndex];
  const next = GROWTH_STAGES[stageIndex + 1];
  const nextAt = next ? next.at : POINTS_PER_TREE;
  const stageProgress = (points - stage.at) / (nextAt - stage.at);

  const todayTasks = taskDays.get(today) ?? new Set();
  const doneToday = DAILY_TASKS.filter((task) => todayTasks.has(task)).length;
  const lastActive = days.length ? days[days.length - 1].day : null;
  const daysSinceActive = lastActive === null ? null : todayDay - lastActive;
  const vitality = vitalityFor(daysSinceActive, doneToday);

  const week = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const key = dayToKey(todayDay - offset);
    week.push({ dateKey: key, done: Math.min(taskDays.get(key)?.size ?? 0, 3) });
  }

  return {
    stage: stage.key,
    stageIndex,
    stageCount: GROWTH_STAGES.length,
    stageProgress: Math.round(stageProgress * 1000) / 1000,
    nextStage: next ? next.key : null,
    pointsToNextStage: nextAt - points,
    points,
    pointsPerTree: POINTS_PER_TREE,
    // 0..1 along the whole seed → full tree axis; what the app draws.
    growth: Math.round((points / POINTS_PER_TREE) * 1000) / 1000,
    totalPoints: total,
    treesGrown: grownTrees.length,
    grownTrees: grownTrees.slice(-24),
    vitality: vitality.state,
    vitalityLevel: vitality.level,
    daysSinceActive,
    today: {
      dateKey: today,
      tasks: DAILY_TASKS.map((key) => ({ key, done: todayTasks.has(key) })),
      done: doneToday,
      total: DAILY_TASKS.length,
    },
    week,
  };
};
