import { dateFromDateKey, dateToDateKey } from './apiHelpers.js';

export const CYCLE_PHASES = ['period', 'follicular', 'ovulation', 'luteal'];

export const getCyclePhase = (cycleDay, periodLength = 5, cycleLength = 28) => {
  if (cycleDay <= periodLength) return 'period';

  // ovulationDay is expressed as a 1-indexed cycleDay (previousStart == day 1),
  // matching computeCyclePredictions' ovulationDate, which lands on
  // cycleLength - 14 days *after* previousStart, i.e. cycleDay (cycleLength - 13).
  // Keeping these in sync ensures the "ovulation" phase bucket lines up with the
  // actual fertile window (ovulationDate -5 .. ovulationDate +1) computed there.
  const ovulationDay = Math.max(periodLength + 1, cycleLength - 13);
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

export const formatDisplayDate = (date, options = {}) =>
  new Intl.DateTimeFormat('en-US', {
    month: options.month ?? 'long',
    day: 'numeric',
  }).format(new Date(date));

/* ──────────────────────────────────────────────
   History-driven cycle prediction
   ──────────────────────────────────────────────
   These helpers are the single source of truth for turning a user's *actual*
   logged bleeding days into a next-period prediction. They intentionally avoid
   any fixed-28-day assumption: the prediction is anchored on the most recent
   real period start and its length comes from the user's own cycle history,
   falling back to the configured cycleLength only when history is too thin.
──────────────────────────────────────────────── */

// A day counts as menstruation for episode-grouping when it has any recorded
// flow other than 'none'. Spotting is included — a period that opens with a
// spotting day still starts on that day. But spotting on its own (mid-cycle
// ovulation spotting, breakthrough bleeding) is not a period: an episode
// needs at least one day of real flow, see derivePeriodEpisodes.
const isBleedingLog = (log) => Boolean(log?.dateKey && log.flow && log.flow !== 'none');
const isFlowLog = (log) => isBleedingLog(log) && log.flow !== 'spotting';

// Sort thresholds — tuned to be robust rather than clever.
export const RECENT_CYCLE_WINDOW = 6; // only the last N cycles drive the estimate
export const REGULAR_VARIABILITY_RANGE = 3; // max-min <= this ⇒ "regular"
export const HIGH_VARIABILITY_RANGE = 8; // max-min > this ⇒ irregular / window
export const MIN_CYCLE_LENGTH = 20;
export const MAX_CYCLE_LENGTH = 45;

const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

const median = (values) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};

// Linear recency weighting: the most recent cycle counts most, the oldest in
// the window counts least. `values` must be in chronological (oldest→newest)
// order.
const weightedRecentMean = (values) => {
  if (!values.length) return null;
  let num = 0;
  let den = 0;
  values.forEach((value, index) => {
    const weight = index + 1;
    num += value * weight;
    den += weight;
  });
  return num / den;
};

// Median absolute deviation — a robust (outlier-resistant) spread measure.
const medianAbsoluteDeviation = (values, center) => {
  if (!values.length) return null;
  return median(values.map((value) => Math.abs(value - center)));
};

// Cycle "lengths" far above the user's typical value are almost always a
// skipped/unlogged period (a "double cycle") rather than a genuine 90-day
// cycle — dropping them stops one missed log from distorting the estimate or
// making a regular user look irregular. Kept deliberately conservative: never
// discard more than 40% of the window (past that the spread is real, not an
// artefact), and never filter with fewer than 3 data points.
export const OUTLIER_HIGH_RATIO = 1.75;
export const OUTLIER_LOW_RATIO = 0.5;

const rejectOutliers = (values) => {
  if (values.length < 3) return { kept: values, removed: 0 };
  const med = median(values);
  const kept = values.filter(
    (value) => value <= med * OUTLIER_HIGH_RATIO && value >= med * OUTLIER_LOW_RATIO,
  );
  if (kept.length < Math.ceil(values.length * 0.6)) return { kept: values, removed: 0 };
  return { kept, removed: values.length - kept.length };
};

/**
 * Group a user's logs into distinct period episodes.
 *
 * Consecutive bleeding days (tolerating up to `maxGap` skipped/unlogged days)
 * form one episode. Returns episodes in chronological order, each as
 * `{ startKey, endKey }` where `startKey` is the *actual* period start.
 * Episodes made only of spotting days are dropped, so a day of mid-cycle
 * spotting can't restart the cycle and move every prediction.
 */
export const derivePeriodEpisodes = (logs = [], { maxGap = 1 } = {}) => {
  const bleedingKeys = [...new Set(logs.filter(isBleedingLog).map((log) => log.dateKey))].sort();

  const episodes = [];
  let current = null;

  bleedingKeys.forEach((key) => {
    if (!current) {
      current = { startKey: key, endKey: key };
      return;
    }
    const gap = diffDays(dateFromDateKey(key), dateFromDateKey(current.endKey));
    if (gap <= maxGap + 1) {
      current.endKey = key;
    } else {
      episodes.push(current);
      current = { startKey: key, endKey: key };
    }
  });

  if (current) episodes.push(current);

  const flowKeys = new Set(logs.filter(isFlowLog).map((log) => log.dateKey));
  return episodes.filter((episode) =>
    bleedingKeys.some(
      (key) => key >= episode.startKey && key <= episode.endKey && flowKeys.has(key),
    ),
  );
};

/**
 * Cycle lengths (in days) between *consecutive actual period start dates* —
 * never from period end dates. Returns chronological (oldest→newest) lengths.
 */
export const computeCycleLengths = (episodes = []) => {
  const lengths = [];
  for (let i = 1; i < episodes.length; i += 1) {
    lengths.push(
      diffDays(dateFromDateKey(episodes[i].startKey), dateFromDateKey(episodes[i - 1].startKey)),
    );
  }
  return lengths;
};

/**
 * Turn a chronological list of historical cycle lengths into a prediction
 * strategy: which length to use, how confident we are, how variable the cycles
 * are, and which method produced it.
 *
 * Thresholds (per product spec):
 *   0–2 cycles  → configured fallback, low confidence
 *   3–5 cycles  → historical median, medium confidence
 *   6+  cycles  → recency-weighted mean (regular) / median (irregular)
 * Irregular (high-variability) cycles never claim high confidence and always
 * report a window rather than an exact date.
 */
export const analyzeCycleHistory = (cycleLengths = [], configuredCycleLength = 28) => {
  const configured = clamp(configuredCycleLength || 28, MIN_CYCLE_LENGTH, MAX_CYCLE_LENGTH);
  // Confidence tiering is based on how many cycles we actually observed…
  const observed = cycleLengths.length;
  const recentRaw = cycleLengths.slice(-RECENT_CYCLE_WINDOW);
  // …but the statistics are computed on an outlier-cleaned window so a single
  // missed-log "double cycle" can't skew them.
  const { kept: recent, removed: outliersRemoved } = rejectOutliers(recentRaw);

  const med = median(recent);
  const min = recent.length ? Math.min(...recent) : null;
  const max = recent.length ? Math.max(...recent) : null;
  const range = min != null ? max - min : null;
  const madValue = med != null ? medianAbsoluteDeviation(recent, med) : null;
  // Robust standard-deviation estimate (MAD × 1.4826). Used both to classify
  // variability and to size the medium-variability prediction window.
  const robustSpread = madValue != null ? Math.round(1.4826 * madValue) : null;

  const classifyVariability = () => {
    if (range == null) return 'unknown';
    // Genuinely irregular only when BOTH the range is wide and the robust
    // spread agrees — this stops one atypical (but non-outlier) cycle from
    // flipping an otherwise steady user to "irregular".
    if (range > HIGH_VARIABILITY_RANGE && (robustSpread ?? 0) >= 4) return 'high';
    if (range <= REGULAR_VARIABILITY_RANGE) return 'low';
    return 'medium';
  };

  const base = {
    cyclesAnalyzed: observed,
    recentCycleLengths: recent,
    medianCycleLength: med,
    minCycleLength: min,
    maxCycleLength: max,
    rangeCycleLength: range,
    robustSpread,
    outliersRemoved,
  };

  // Not enough real cycles yet — lean on the configured length, flag low
  // confidence, and don't pretend we know the user's regularity.
  if (observed < 3) {
    return {
      ...base,
      predictedCycleLength: configured,
      method: 'configured_cycle',
      confidence: 'low',
      variability: classifyVariability(),
      isRegular: null,
    };
  }

  const variability = classifyVariability();

  // Irregular / PCOS-like history: never assume 28, use the median (robust to
  // the odd very long or very short cycle) and surface a window.
  if (variability === 'high') {
    return {
      ...base,
      predictedCycleLength: clamp(Math.round(med), MIN_CYCLE_LENGTH, MAX_CYCLE_LENGTH),
      method: 'irregular_range',
      confidence: observed >= RECENT_CYCLE_WINDOW ? 'medium' : 'low',
      variability,
      isRegular: false,
    };
  }

  // Regular-enough history. With a robust amount of data (6+) prefer a
  // recency-weighted mean; with 3–5 cycles use the median.
  if (observed >= RECENT_CYCLE_WINDOW) {
    return {
      ...base,
      predictedCycleLength: clamp(
        Math.round(weightedRecentMean(recent)),
        MIN_CYCLE_LENGTH,
        MAX_CYCLE_LENGTH,
      ),
      method: 'historical_weighted',
      confidence: variability === 'low' ? 'high' : 'medium',
      variability,
      isRegular: true,
    };
  }

  return {
    ...base,
    predictedCycleLength: clamp(Math.round(med), MIN_CYCLE_LENGTH, MAX_CYCLE_LENGTH),
    method: 'historical_median',
    confidence: 'medium',
    variability,
    isRegular: true,
  };
};

/**
 * Compute next-period / phase / fertility predictions.
 *
 * @param settings CycleSettings (lastPeriodStartDate, cycleLength, periodLength)
 * @param logs     Optional CycleLog history — when present the prediction is
 *                 anchored on the most recent *actual* period start and its
 *                 length is derived from real cycle history. Omitting logs
 *                 preserves the legacy configured-only behaviour.
 */
export const computeCyclePredictions = (settings, logs = [], options = {}) => {
  // Back-compat: older callers pass (settings, options) with no logs.
  if (logs && !Array.isArray(logs)) {
    options = logs;
    logs = [];
  }

  const periodLength = settings.periodLength || 5;
  const today = options.today ? new Date(options.today) : new Date();

  const episodes = derivePeriodEpisodes(logs);
  const cycleLengths = computeCycleLengths(episodes);
  const analysis = analyzeCycleHistory(cycleLengths, settings.cycleLength || 28);
  const cycleLength = analysis.predictedCycleLength;

  // The prediction anchor is the most recent *actual* logged period start; only
  // when the user has never logged a bleeding day do we fall back to the
  // configured lastPeriodStartDate. This guarantees a freshly-logged period
  // (even one that differs from a previously predicted date) immediately
  // becomes the basis for the next prediction.
  const lastEpisode = episodes[episodes.length - 1];
  const anchor = lastEpisode
    ? dateFromDateKey(lastEpisode.startKey)
    : new Date(settings.lastPeriodStartDate);
  const actualPeriodStartISO = lastEpisode
    ? dateFromDateKey(lastEpisode.startKey).toISOString()
    : null;
  const actualPeriodEndISO = lastEpisode ? dateFromDateKey(lastEpisode.endKey).toISOString() : null;

  // How long ago was the anchoring period, and how many cycles has the user
  // apparently skipped logging? Projecting many cycles forward from a stale
  // anchor compounds error, so we track this to degrade confidence below.
  const daysSinceLastActualPeriod = lastEpisode ? Math.max(0, diffDays(today, anchor)) : null;
  const skippedCycles =
    daysSinceLastActualPeriod != null
      ? Math.max(0, Math.floor(daysSinceLastActualPeriod / cycleLength))
      : 0;
  const isStale = skippedCycles >= 2;

  let nextStart = new Date(anchor);
  while (diffDays(nextStart, today) <= 0) {
    nextStart = addDays(nextStart, cycleLength);
  }

  const previousStart = addDays(nextStart, -cycleLength);
  const cycleDay = Math.max(1, diffDays(today, previousStart) + 1);
  const phase = getCyclePhase(cycleDay, periodLength, cycleLength);
  const ovulationDate = addDays(previousStart, cycleLength - 14);
  const fertileStart = addDays(ovulationDate, -5);
  const fertileEnd = addDays(ovulationDate, 1);
  // periodLength is inclusive of the start day: a 6-day period is start + 5.
  const periodEnd = addDays(previousStart, periodLength - 1);
  const nextPeriodEnd = addDays(nextStart, periodLength - 1);

  // Prediction window, sized to how variable the user's cycles are:
  //   high   → the real spread between the shortest and longest recent cycle
  //   medium → predicted ± robust spread (MAD-based), min ±2 days
  //   low    → a tight ±1-day "estimate" band
  // A stale anchor widens the window too, since a many-cycles-forward
  // projection is inherently less precise.
  let windowRadius;
  if (analysis.variability === 'high') {
    const spanMin = analysis.minCycleLength ?? cycleLength;
    const spanMax = analysis.maxCycleLength ?? cycleLength;
    windowRadius = Math.max(cycleLength - spanMin, spanMax - cycleLength, 2);
  } else if (analysis.variability === 'medium') {
    windowRadius = Math.max(2, analysis.robustSpread ?? 2);
  } else {
    windowRadius = 1;
  }
  if (isStale) windowRadius += Math.min(skippedCycles, 4);

  const isEstimate = analysis.variability !== 'low' || isStale;
  const earliestStart = addDays(nextStart, -windowRadius);
  const latestStart = addDays(nextStart, windowRadius);

  // Confidence degrades when the anchor is stale (the user stopped logging for
  // ≥2 predicted cycles) — a projection that far forward is a guess, not a
  // measurement.
  const CONFIDENCE_DOWNGRADE = { high: 'medium', medium: 'low', low: 'low' };
  const confidence = isStale
    ? (CONFIDENCE_DOWNGRADE[analysis.confidence] ?? analysis.confidence)
    : analysis.confidence;

  // Calendar-based ovulation is unreliable for highly irregular cycles.
  const ovulationReliable = analysis.variability !== 'high';

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
    ovulationReliable,
    fertileWindowStartISO: fertileStart.toISOString(),
    fertileWindowEndISO: fertileEnd.toISOString(),
    fertileWindowRange: `${formatDisplayDate(fertileStart, { month: 'short' })}-${formatDisplayDate(fertileEnd, { month: 'short' })}`,
    fertileWindowDuration: '6 day window',
    fertileWindowReliable: ovulationReliable,
    periodLength,
    cycleLength,

    // ── Distinct predicted vs. actual data model ──
    predictedPeriodStartISO: nextStart.toISOString(),
    predictedPeriodEndISO: nextPeriodEnd.toISOString(),
    predictedPeriodStartEarliestISO: earliestStart.toISOString(),
    predictedPeriodStartLatestISO: latestStart.toISOString(),
    predictedWindowRange: `${formatDisplayDate(earliestStart, { month: 'short' })}-${formatDisplayDate(latestStart, { month: 'short' })}`,
    actualPeriodStartISO,
    actualPeriodEndISO,

    // ── Prediction quality metadata ──
    predictionMethod: analysis.method,
    confidence,
    variability: analysis.variability,
    isRegular: analysis.isRegular,
    isEstimate,
    cyclesAnalyzed: analysis.cyclesAnalyzed,
    cycleLengthHistory: analysis.recentCycleLengths,
    medianCycleLength: analysis.medianCycleLength,
    minCycleLength: analysis.minCycleLength,
    maxCycleLength: analysis.maxCycleLength,
    outliersRemoved: analysis.outliersRemoved,

    // ── Staleness (user stopped logging) ──
    daysSinceLastActualPeriod,
    skippedCycles,
    isStale,

    isDataHighlyAccurate: confidence === 'high',
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

/**
 * Counts consecutive days logged, walking back from `todayKey`.
 *
 * `todayKey` (YYYY-MM-DD) is the anchor for "today" and should be the *client's*
 * local date — day logs are keyed by the user's local date, so anchoring the
 * streak to server-UTC "today" would mis-count near midnight for users far from
 * UTC. It defaults to UTC today only as a fallback. Iteration uses UTC date math
 * on a Z-parsed cursor so it doesn't drift with the server's own timezone.
 */
export const calculateTrackingStreak = (
  logs = [],
  todayKey = new Date().toISOString().slice(0, 10),
) => {
  const loggedDates = new Set(logs.map((log) => log.dateKey));
  let streak = 0;

  const cursor = new Date(`${todayKey}T00:00:00Z`);
  let dateKey = todayKey;

  // A streak is still "alive" if today isn't logged yet but yesterday was.
  if (!loggedDates.has(dateKey)) {
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    dateKey = cursor.toISOString().slice(0, 10);
  }

  while (loggedDates.has(dateKey)) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
    dateKey = cursor.toISOString().slice(0, 10);
  }

  return streak;
};
