import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePeriodEpisodes,
  computeCycleLengths,
  analyzeCycleHistory,
  computeCyclePredictions,
  predictCycleFromHistory,
  prepareCycleHistory,
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

test('derivePeriodEpisodes: spotting alone is not a period, leading spotting still starts one', () => {
  const day = (dateKey, flow) => ({ dateKey, flow });
  const logs = [
    day('2026-08-01', 'spotting'),
    day('2026-08-02', 'medium'),
    day('2026-08-03', 'light'),
    day('2026-08-15', 'spotting'), // mid-cycle spotting
    day('2026-08-29', 'heavy'),
  ];
  assert.deepEqual(derivePeriodEpisodes(logs), [
    { startKey: '2026-08-01', endKey: '2026-08-03' },
    { startKey: '2026-08-29', endKey: '2026-08-29' },
  ]);
  assert.deepEqual(derivePeriodEpisodes([day('2026-08-15', 'spotting')]), []);
});

/* ── prepared history (symptom predictions) ──────────────
   predictCycleFromHistory(settings, prepareCycleHistory(settings, logs), o)
   must equal computeCyclePredictions(settings, logs, o) for every date, so
   GET /api/cycle/symptom-predictions can build the history once instead of
   once per symptom log.
──────────────────────────────────────────────────────── */
const seededRandom = (seed) => () => {
  seed = (seed * 1664525 + 1013904223) % 4294967296;
  return seed / 4294967296;
};

const syntheticHistory = (seed) => {
  const random = seededRandom(seed);
  const logs = [];
  let start = '2024-01-03';
  const cycles = 2 + Math.floor(random() * 10);
  for (let c = 0; c < cycles; c += 1) {
    const cycleLength = 21 + Math.floor(random() * 20);
    const periodLength = 3 + Math.floor(random() * 5);
    for (let d = 0; d < cycleLength; d += 1) {
      if (random() < 0.45) continue; // unlogged day
      const dateKey = shiftKey(start, d);
      const flows = ['light', 'medium', 'heavy', 'spotting'];
      logs.push({
        dateKey,
        date: new Date(`${dateKey}T${random() < 0.5 ? '00:00' : '13:45'}:00.000Z`),
        flow:
          d < periodLength
            ? flows[Math.floor(random() * 4)]
            : random() < 0.05
              ? 'spotting'
              : 'none',
        symptoms:
          random() < 0.4
            ? ['cramps', 'bloating', 'headache'].slice(0, 1 + Math.floor(random() * 3))
            : [],
      });
    }
    start = shiftKey(start, cycleLength);
  }
  return logs;
};

const symptomBuckets = (logs, predict) => {
  const buckets = {};
  logs
    .filter((log) => log.symptoms.length > 0)
    .forEach((log) => {
      const { currentPeriodStartDateISO, currentPhase } = predict(log.date);
      log.symptoms.forEach((symptom) => {
        const key = `${symptom}::${currentPhase}`;
        buckets[key] = [...new Set([...(buckets[key] || []), currentPeriodStartDateISO])];
      });
    });
  return buckets;
};

test('prepared history predicts exactly like computeCyclePredictions on every date', () => {
  for (let seed = 1; seed <= 40; seed += 1) {
    const logs = syntheticHistory(seed);
    const settings = {
      cycleLength: 24 + (seed % 10),
      periodLength: 3 + (seed % 5),
      lastPeriodStartDate: new Date(seed % 3 === 0 ? '2030-01-01' : '2024-01-01'),
    };
    const history = prepareCycleHistory(settings, logs);
    for (const log of logs) {
      assert.deepEqual(
        predictCycleFromHistory(settings, history, { today: log.date }),
        computeCyclePredictions(settings, logs, { today: log.date }),
      );
    }
    // The symptom-prediction bucketing, old (quadratic) vs new.
    assert.deepEqual(
      symptomBuckets(logs, (today) => predictCycleFromHistory(settings, history, { today })),
      symptomBuckets(logs, (today) => computeCyclePredictions(settings, logs, { today })),
    );
  }
});

test('prepared history with no logs matches the configured-only prediction', () => {
  const settings = {
    cycleLength: 30,
    periodLength: 4,
    lastPeriodStartDate: new Date('2026-01-10'),
  };
  const today = new Date('2026-03-01T00:00:00Z');
  assert.deepEqual(
    predictCycleFromHistory(settings, prepareCycleHistory(settings, []), { today }),
    computeCyclePredictions(settings, { today }),
  );
});
