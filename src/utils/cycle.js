import {
  dateFromDateKey,
  dateToDateKey,
} from './apiHelpers.js';

export const CYCLE_PHASES = ['period', 'follicular', 'ovulation', 'luteal'];

export const getCyclePhase = (cycleDay, periodLength = 5, cycleLength = 28) => {
  if (cycleDay <= periodLength) return 'period';

  const ovulationDay = Math.max(periodLength + 1, cycleLength - 14);
  if (cycleDay < ovulationDay - 5) return 'follicular';
  if (cycleDay <= ovulationDay + 1) return 'ovulation';

  return 'luteal';
};

export const addDays = (date, days) => {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
};

export const diffDays = (a, b) => {
  const startA = dateFromDateKey(dateToDateKey(a));
  const startB = dateFromDateKey(dateToDateKey(b));
  return Math.round((startA - startB) / (1000 * 60 * 60 * 24));
};

export const formatDisplayDate = (date, options = {}) => new Intl.DateTimeFormat('en-US', {
  month: options.month ?? 'long',
  day: 'numeric',
}).format(new Date(date));

export const computeCyclePredictions = (settings, options = {}) => {
  const cycleLength = settings.cycleLength || 28;
  const periodLength = settings.periodLength || 5;
  const today = options.today ? new Date(options.today) : new Date();
  const start = new Date(settings.lastPeriodStartDate);

  let nextStart = new Date(start);
  while (diffDays(nextStart, today) <= 0) {
    nextStart = addDays(nextStart, cycleLength);
  }

  const previousStart = addDays(nextStart, -cycleLength);
  const cycleDay = Math.max(1, diffDays(today, previousStart) + 1);
  const phase = getCyclePhase(cycleDay, periodLength, cycleLength);
  const ovulationDate = addDays(previousStart, cycleLength - 14);
  const fertileStart = addDays(ovulationDate, -5);
  const fertileEnd = addDays(ovulationDate, 1);
  const periodEnd = addDays(previousStart, periodLength - 1);

  return {
    currentCycleDay: cycleDay,
    currentPhase: phase,
    currentPeriodStartDateISO: previousStart.toISOString(),
    currentPeriodEndDateISO: periodEnd.toISOString(),
    nextPeriodDate: formatDisplayDate(nextStart),
    nextPeriodDateISO: nextStart.toISOString(),
    nextPeriodDateKey: dateToDateKey(nextStart),
    nextPeriodDaysAway: Math.max(0, diffDays(nextStart, today)),
    ovulationDate: formatDisplayDate(ovulationDate),
    ovulationDateISO: ovulationDate.toISOString(),
    ovulationDateKey: dateToDateKey(ovulationDate),
    ovulationDaysAway: Math.max(0, diffDays(ovulationDate, today)),
    fertileWindowStartISO: fertileStart.toISOString(),
    fertileWindowEndISO: fertileEnd.toISOString(),
    fertileWindowRange: `${formatDisplayDate(fertileStart, { month: 'short' })}-${formatDisplayDate(fertileEnd, { month: 'short' })}`,
    fertileWindowDuration: '6 day window',
    periodLength,
    cycleLength,
    isDataHighlyAccurate: true,
  };
};

export const buildCycleAnalytics = (logs = [], settings = null) => {
  const byMonth = new Map();

  logs.forEach((log) => {
    if (!log.dateKey) return;
    const month = log.dateKey.slice(0, 7);
    const current = byMonth.get(month) || {
      month,
      daysLogged: 0,
      periodDays: 0,
      symptoms: 0,
    };

    current.daysLogged += 1;
    if (log.flow && log.flow !== 'none') current.periodDays += 1;
    current.symptoms += log.symptoms?.length || 0;
    byMonth.set(month, current);
  });

  return [...byMonth.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-6)
    .map((item) => ({
      ...item,
      estimatedCycleLength: settings?.cycleLength || null,
    }));
};
