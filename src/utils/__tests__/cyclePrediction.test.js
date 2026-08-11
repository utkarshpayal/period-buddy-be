import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePeriodEpisodes,
  computeCycleLengths,
  analyzeCycleHistory,
  computeCyclePredictions,
} from '../cycle.js';

/* ── fixtures ─────────────────────────────────────────────
   Build CycleLog-shaped bleeding logs from a list of period start dateKeys.
   Each period is `periodLength` consecutive bleeding days (inclusive).
──────────────────────────────────────────────────────── */
const shiftKey = (key, days) => {
  const d = new Date(`${key}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const buildLogs = (startKeys, periodLength = 5, flow = 'medium') =>
  startKeys.flatMap((startKey) =>
    Array.from({ length: periodLength }, (_, i) => ({
      dateKey: shiftKey(startKey, i),
      date: new Date(`${shiftKey(startKey, i)}T00:00:00.000Z`),
      flow,
    })),
  );

// Regular cycle start dates: every 28 days.
const regularStarts = (count, first = '2026-01-01', len = 28) =>
  Array.from({ length: count }, (_, i) => shiftKey(first, i * len));

/* ── episode + cycle-length derivation ──────────────────── */

test('derivePeriodEpisodes groups consecutive bleeding days into one episode', () => {
  const logs = buildLogs(['2026-01-10'], 6);
  const episodes = derivePeriodEpisodes(logs);
  assert.equal(episodes.length, 1);
  assert.equal(episodes[0].startKey, '2026-01-10');
  assert.equal(episodes[0].endKey, '2026-01-15'); // 6-day period inclusive
});

test('cycle length is computed from consecutive START dates, not end dates', () => {
  // Two periods of very different lengths, 28 days apart by START.
  const logs = [...buildLogs(['2026-01-01'], 3), ...buildLogs(['2026-01-29'], 8)];
  const lengths = computeCycleLengths(derivePeriodEpisodes(logs));
  assert.deepEqual(lengths, [28]); // 29-01 is 28 days after 01-01 regardless of end dates
});

/* ── (h) period-length inclusive ────────────────────────── */

test('(h) period length is inclusive: a 6-day period ends on start + 5', () => {
  const settings = { lastPeriodStartDate: '2026-01-10', cycleLength: 28, periodLength: 6 };
  const logs = buildLogs(['2026-01-10'], 6);
  const p = computeCyclePredictions(settings, logs, { today: new Date('2026-01-20T00:00:00Z') });
  // Next predicted start Feb 7 → predicted end Feb 12 (6 days inclusive).
  assert.equal(p.predictedPeriodStartISO.slice(0, 10), '2026-02-07');
  assert.equal(p.predictedPeriodEndISO.slice(0, 10), '2026-02-12');
});

/* ── (a) predicted Jan 9 → actual Jan 10 → next Feb 7 ────── */

test('(a) actual period start overrides a stale predicted date as the anchor', () => {
  // Onboarding said the last period started Jan 9 (a prediction), but the user
  // actually logged bleeding starting Jan 10. The next prediction must anchor
  // on Jan 10, not Jan 9.
  const settings = { lastPeriodStartDate: '2026-01-09', cycleLength: 28, periodLength: 6 };
  const logs = buildLogs(['2026-01-10'], 6);
  const p = computeCyclePredictions(settings, logs, { today: new Date('2026-01-20T00:00:00Z') });
  assert.equal(p.actualPeriodStartISO.slice(0, 10), '2026-01-10');
  assert.equal(p.nextPeriodDateISO.slice(0, 10), '2026-02-07'); // Jan 10 + 28
});

/* ── (b) 28-day regular cycles ──────────────────────────── */

test('(b) regular 28-day history predicts a 28-day cycle with high confidence', () => {
  const starts = regularStarts(7); // 6 cycle lengths, all 28
  const logs = buildLogs(starts, 5);
  const settings = { lastPeriodStartDate: starts[0], cycleLength: 30, periodLength: 5 };
  const today = new Date(`${shiftKey(starts[starts.length - 1], 10)}T00:00:00Z`);
  const p = computeCyclePredictions(settings, logs, { today });
  assert.equal(p.cycleLength, 28); // history overrides the configured 30
  assert.equal(p.predictionMethod, 'historical_weighted');
  assert.equal(p.confidence, 'high');
  assert.equal(p.variability, 'low');
  assert.equal(p.isRegular, true);
  assert.equal(p.isDataHighlyAccurate, true);
  assert.equal(p.isEstimate, false);
});

/* ── (c) irregular cycles ───────────────────────────────── */

test('(c) irregular cycles produce a window and never claim high confidence', () => {
  // Cycle lengths [35, 42, 31, 50, 37] — median 37, min 31, max 50.
  const lens = [35, 42, 31, 50, 37];
  let key = '2026-01-01';
  const starts = [key];
  lens.forEach((l) => {
    key = shiftKey(key, l);
    starts.push(key);
  });
  const logs = buildLogs(starts, 5);
  const settings = { lastPeriodStartDate: starts[0], cycleLength: 28, periodLength: 5 };
  const analysis = analyzeCycleHistory(lens, 28);
  assert.equal(analysis.medianCycleLength, 37);
  assert.equal(analysis.minCycleLength, 31);
  assert.equal(analysis.maxCycleLength, 50);
  assert.equal(analysis.variability, 'high');
  assert.equal(analysis.method, 'irregular_range');
  assert.notEqual(analysis.confidence, 'high');

  const today = new Date(`${shiftKey(starts[starts.length - 1], 5)}T00:00:00Z`);
  const p = computeCyclePredictions(settings, logs, { today });
  assert.equal(p.cycleLength, 37); // median, not 28
  assert.equal(p.isEstimate, true);
  assert.equal(p.ovulationReliable, false); // no exact ovulation for irregular
  assert.ok(p.predictedPeriodStartEarliestISO < p.predictedPeriodStartLatestISO);
});

/* ── (d) PCOS / long irregular history ──────────────────── */

test('(d) PCOS-like long cycles never assume 28 days', () => {
  const analysis = analyzeCycleHistory([45, 60, 38, 52, 41, 66], 28);
  assert.notEqual(analysis.predictedCycleLength, 28);
  assert.equal(analysis.variability, 'high');
  assert.equal(analysis.isRegular, false);
  // Irregular cannot be claimed as PCOS by the algorithm — it only reports variability.
  assert.equal(analysis.method, 'irregular_range');
});

/* ── (e) insufficient history ───────────────────────────── */

test('(e) 0-2 cycles fall back to configured length with low confidence', () => {
  const analysis0 = analyzeCycleHistory([], 30);
  assert.equal(analysis0.predictedCycleLength, 30);
  assert.equal(analysis0.method, 'configured_cycle');
  assert.equal(analysis0.confidence, 'low');
  assert.equal(analysis0.isRegular, null);

  const analysis2 = analyzeCycleHistory([29, 30], 30);
  assert.equal(analysis2.predictedCycleLength, 30); // still configured fallback
  assert.equal(analysis2.confidence, 'low');
});

test('(e) 3-5 cycles begin using historical median', () => {
  const analysis = analyzeCycleHistory([27, 28, 29], 32);
  assert.equal(analysis.method, 'historical_median');
  assert.equal(analysis.confidence, 'medium');
  assert.equal(analysis.predictedCycleLength, 28); // median, not configured 32
});

/* ── (f) edited / corrected actual period ───────────────── */

test('(f) editing the actual period date moves the anchor and the next prediction', () => {
  const settings = { lastPeriodStartDate: '2026-01-09', cycleLength: 28, periodLength: 5 };
  const today = new Date('2026-01-25T00:00:00Z');

  const before = computeCyclePredictions(settings, buildLogs(['2026-01-10'], 5), { today });
  assert.equal(before.nextPeriodDateISO.slice(0, 10), '2026-02-07');

  // User corrects the logged start to Jan 12 → next start shifts to Feb 9.
  const after = computeCyclePredictions(settings, buildLogs(['2026-01-12'], 5), { today });
  assert.equal(after.actualPeriodStartISO.slice(0, 10), '2026-01-12');
  assert.equal(after.nextPeriodDateISO.slice(0, 10), '2026-02-09');
});

/* ── (g) high variability classification ────────────────── */

test('(g) high cycle variability is classified and produces a window', () => {
  const analysis = analyzeCycleHistory([25, 40, 28, 45], 28);
  assert.equal(analysis.variability, 'high'); // range 20 > threshold
  const low = analyzeCycleHistory([28, 29, 28, 30, 29, 28], 28);
  assert.equal(low.variability, 'low'); // range 2 <= 3
});

/* ── edge cases ─────────────────────────────────────────── */

test('missing period logs → falls back to configured settings anchor', () => {
  const settings = { lastPeriodStartDate: '2026-01-01', cycleLength: 28, periodLength: 5 };
  const p = computeCyclePredictions(settings, [], { today: new Date('2026-01-15T00:00:00Z') });
  assert.equal(p.actualPeriodStartISO, null);
  assert.equal(p.predictionMethod, 'configured_cycle');
  assert.equal(p.nextPeriodDateISO.slice(0, 10), '2026-01-29');
});

test('multiple period records use the most recent as the anchor', () => {
  const settings = { lastPeriodStartDate: '2026-01-01', cycleLength: 28, periodLength: 5 };
  const logs = buildLogs(['2026-01-01', '2026-01-29', '2026-02-26'], 5);
  const p = computeCyclePredictions(settings, logs, { today: new Date('2026-03-01T00:00:00Z') });
  assert.equal(p.actualPeriodStartISO.slice(0, 10), '2026-02-26');
  assert.equal(p.cyclesAnalyzed, 2);
});

/* ── robustness: outliers & staleness ───────────────────── */

test('a single missed-log "double cycle" is rejected as an outlier', () => {
  // [28,28,90,28,28,28] — the 90 is a skipped period, not a real cycle.
  const analysis = analyzeCycleHistory([28, 28, 90, 28, 28, 28], 28);
  assert.equal(analysis.outliersRemoved, 1);
  assert.equal(analysis.predictedCycleLength, 28);
  assert.equal(analysis.variability, 'low');
  assert.equal(analysis.isRegular, true);
});

test('genuine spread is NOT over-filtered (keeps >=60% of the window)', () => {
  // Three of six cycles are long — that is real irregularity, not one artefact.
  const analysis = analyzeCycleHistory([28, 55, 30, 58, 29, 60], 28);
  assert.equal(analysis.outliersRemoved, 0);
  assert.equal(analysis.variability, 'high');
});

test('medium variability produces a window and marks the date an estimate', () => {
  const starts = [];
  let key = '2026-01-01';
  starts.push(key);
  [27, 32, 29, 33, 28, 31].forEach((l) => {
    key = shiftKey(key, l);
    starts.push(key);
  });
  const settings = { lastPeriodStartDate: starts[0], cycleLength: 28, periodLength: 5 };
  const today = new Date(`${shiftKey(starts[starts.length - 1], 8)}T00:00:00Z`);
  const p = computeCyclePredictions(settings, buildLogs(starts, 5), { today });
  assert.equal(p.variability, 'medium');
  assert.equal(p.isEstimate, true);
  assert.ok(p.predictedPeriodStartEarliestISO < p.predictedPeriodStartLatestISO);
});

test('a stale anchor (user stopped logging) degrades confidence and flags staleness', () => {
  // 3 regular cycles, but "today" is ~7 cycles after the last logged period.
  const starts = regularStarts(4, '2026-01-01'); // last start 2026-03-26
  const settings = { lastPeriodStartDate: starts[0], cycleLength: 28, periodLength: 5 };
  const fresh = computeCyclePredictions(settings, buildLogs(starts, 5), {
    today: new Date('2026-04-10T00:00:00Z'),
  });
  assert.equal(fresh.isStale, false);
  assert.equal(fresh.confidence, 'medium');

  const stale = computeCyclePredictions(settings, buildLogs(starts, 5), {
    today: new Date('2026-11-01T00:00:00Z'),
  });
  assert.equal(stale.isStale, true);
  assert.ok(stale.skippedCycles >= 2);
  assert.equal(stale.confidence, 'low'); // downgraded from medium
  assert.equal(stale.isEstimate, true);
});

test('legacy (settings, options) call signature still works', () => {
  const settings = { lastPeriodStartDate: '2026-01-01', cycleLength: 28, periodLength: 5 };
  const p = computeCyclePredictions(settings, { today: new Date('2026-01-15T00:00:00Z') });
  assert.equal(p.nextPeriodDateKey, '2026-01-29');
});
