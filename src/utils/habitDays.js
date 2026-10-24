import { shiftDateKey } from './forestGrowth.js';

/**
 * Days in a row a habit was done, counted back from the person's local
 * today. A streak still stands in the morning until today is over: if today
 * isn't ticked yet, it counts from yesterday.
 */
export const habitStreak = (dateKeys = [], todayKey) => {
  const done = new Set(dateKeys);
  let cursor = done.has(todayKey) ? todayKey : shiftDateKey(todayKey, -1);
  let streak = 0;
  while (done.has(cursor)) {
    streak += 1;
    cursor = shiftDateKey(cursor, -1);
  }
  return streak;
};

/** The last 7 local days, oldest first, each with whether the habit was done. */
export const habitWeek = (dateKeys = [], todayKey) => {
  const done = new Set(dateKeys);
  return Array.from({ length: 7 }, (_, i) => {
    const dateKey = shiftDateKey(todayKey, i - 6);
    return { dateKey, done: done.has(dateKey) };
  });
};

/** Most active habits one person may have; past this, adding one is refused. */
export const MAX_ACTIVE_HABITS = 20;
