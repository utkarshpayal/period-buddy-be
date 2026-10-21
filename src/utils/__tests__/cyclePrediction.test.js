import test from 'node:test';
import assert from 'node:assert/strict';
import {
  derivePeriodEpisodes,
  computeCycleLengths,
  analyzeCycleHistory,
  computeCyclePredictions,
  cycleForDate,
  getCyclePhase,
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

test('a single missed-log "double cycle" is left out of the statistics', () => {
  // [28,28,90,28,28,28] — the 90 is a skipped period, not a real cycle; it's
  // past the 60-day plausibility bound, so it never reaches the statistics.
  const analysis = analyzeCycleHistory([28, 28, 90, 28, 28, 28], 28);
  assert.equal(analysis.cyclesAnalyzed, 5);
  assert.deepEqual(analysis.recentCycleLengths, [28, 28, 28, 28, 28]);
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

test('derivePeriodEpisodes: spotting alone is not a period; day 1 is the first day of real flow', () => {
  const day = (dateKey, flow) => ({ dateKey, flow });
  const logs = [
    day('2026-08-01', 'spotting'),
    day('2026-08-02', 'medium'),
    day('2026-08-03', 'light'),
    day('2026-08-15', 'spotting'), // mid-cycle spotting
    day('2026-08-29', 'heavy'),
  ];
  // The spotting on 08-01 is pre-menstrual: the period starts 08-02.
  assert.deepEqual(derivePeriodEpisodes(logs), [
    { startKey: '2026-08-02', endKey: '2026-08-03' },
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

/* ── cycleForDate (per-log cycle + phase) ───────────────
   Past logs belong to the period that started on or before them, not to a
   projection from the latest period (which put every older log in one
   "period" bucket of the same cycle).
──────────────────────────────────────────────────────── */
const bleed = (start, days = 5) =>
  Array.from({ length: days }, (_, i) => ({ dateKey: shiftKey(start, i), flow: 'medium' }));

test('cycleForDate places past days in their own cycle and phase', () => {
  const settings = { cycleLength: 28, periodLength: 5, lastPeriodStartDate: null };
  const starts = ['2026-01-01', '2026-01-29', '2026-02-26', '2026-03-26'];
  const history = prepareCycleHistory(
    settings,
    starts.flatMap((s) => bleed(s)),
  );

  assert.deepEqual(cycleForDate(settings, history, '2026-01-02'), {
    cycleKey: '2026-01-01',
    phase: 'period',
  });
  assert.deepEqual(cycleForDate(settings, history, '2026-01-08'), {
    cycleKey: '2026-01-01',
    phase: 'follicular',
  });
  assert.deepEqual(cycleForDate(settings, history, '2026-02-10'), {
    cycleKey: '2026-01-29',
    phase: 'ovulation',
  });
  assert.deepEqual(cycleForDate(settings, history, '2026-03-22'), {
    cycleKey: '2026-02-26',
    phase: 'luteal',
  });
  // Before any logged period: nothing to place it in.
  assert.equal(cycleForDate(settings, history, '2025-12-20'), null);
  // After the last logged period: the projected current cycle.
  assert.equal(cycleForDate(settings, history, '2026-03-30').cycleKey, '2026-03-26');
});

test('cycleForDate splits a gap with unlogged periods into usual-length cycles', () => {
  const settings = { cycleLength: 28, periodLength: 5, lastPeriodStartDate: null };
  // 01-01 and 01-29 logged, then nothing until 03-26 (02-26 went unlogged).
  const history = prepareCycleHistory(
    settings,
    ['2026-01-01', '2026-01-29', '2026-03-26'].flatMap((s) => bleed(s)),
  );
  const usual = history.analysis.predictedCycleLength;
  const placed = cycleForDate(settings, history, shiftKey('2026-01-29', usual + 2));
  assert.equal(placed.cycleKey, shiftKey('2026-01-29', usual));
  assert.equal(placed.phase, 'period');
});

/* ── medical accuracy (ACOG / FIGO / Wilcox) ──────────────
   Late periods stay late, the fertile window is 6 days ending on ovulation,
   regularity follows FIGO, and implausible or out-of-range cycles are
   handled honestly.
──────────────────────────────────────────────────────── */
const figoStarts = ['2026-06-01', '2026-06-29', '2026-07-27', '2026-08-24']; // 28-day cycles
const figoLogs = figoStarts.flatMap((s) => bleed(s));
const figoSettings = { cycleLength: 28, periodLength: 5, lastPeriodStartDate: null };
const atDay = (key) => new Date(`${key}T12:00:00.000Z`);

test('a late period stays late instead of starting a phantom cycle', () => {
  // Due 2026-09-21. Still logging (a symptom log on 09-22), no bleeding.
  const logs = [...figoLogs, { dateKey: '2026-09-22', flow: 'none' }];
  const p = computeCyclePredictions(figoSettings, logs, { today: atDay('2026-09-23') });
  assert.equal(p.isLate, true);
  assert.equal(p.daysLate, 2);
  assert.equal(p.nextPeriodDateKey, '2026-09-21');
  assert.equal(p.currentCycleDay, 31);
  assert.equal(p.currentPhase, 'luteal');
  assert.equal(p.currentPeriodStartDateISO.slice(0, 10), '2026-08-24');
  assert.equal(p.isStale, false);
});

test('due today is not late; the day before is a normal luteal day', () => {
  const due = computeCyclePredictions(figoSettings, figoLogs, { today: atDay('2026-09-21') });
  assert.equal(due.isLate, false);
  assert.equal(due.nextPeriodDaysAway, 0);
  assert.equal(due.currentPhase, 'luteal');
  const before = computeCyclePredictions(figoSettings, figoLogs, { today: atDay('2026-09-20') });
  assert.equal(before.currentCycleDay, 28);
  assert.equal(before.nextPeriodDaysAway, 1);
});

test('90+ days without a period while still logging flags a doctor visit', () => {
  const logs = [...figoLogs, { dateKey: '2026-11-25', flow: 'none' }];
  const p = computeCyclePredictions(figoSettings, logs, { today: atDay('2026-11-28') });
  assert.equal(p.isLate, true);
  assert.equal(p.noPeriodTooLong, true);
});

test('someone who stopped logging is projected forward and flagged stale, not late', () => {
  const p = computeCyclePredictions(figoSettings, figoLogs, { today: atDay('2026-12-30') });
  assert.equal(p.isLate, false);
  assert.equal(p.isStale, true);
});

test('fertile window is the 5 days before ovulation plus ovulation day', () => {
  const p = computeCyclePredictions(figoSettings, figoLogs, { today: atDay('2026-08-26') });
  // Cycle from 08-24: ovulation = start + 14 = 09-07 (14 days before 09-21).
  assert.equal(p.ovulationDateKey, '2026-09-07');
  assert.equal(p.fertileWindowStartISO.slice(0, 10), '2026-09-02');
  assert.equal(p.fertileWindowEndISO.slice(0, 10), '2026-09-07');
  assert.equal(p.peakFertileStartISO.slice(0, 10), '2026-09-05');
  // getCyclePhase agrees: cycle days 10–15 of 28 are the fertile phase.
  const phases = Array.from({ length: 28 }, (_, i) => getCyclePhase(i + 1, 5, 28));
  assert.equal(phases.indexOf('ovulation') + 1, 10);
  assert.equal(phases.lastIndexOf('ovulation') + 1, 15);
  assert.equal(phases[15], 'luteal');
});

test('FIGO regularity: a 10-day spread is irregular; age widens the limit to 9', () => {
  const wide = analyzeCycleHistory([26, 26, 26, 36, 27], 28);
  assert.equal(wide.variability, 'high');
  assert.equal(wide.isRegular, false);
  const eight = [27, 30, 35, 28, 29];
  assert.equal(analyzeCycleHistory(eight, 28, { age: 30 }).isRegular, false);
  assert.notEqual(analyzeCycleHistory(eight, 28, { age: 20 }).isRegular, false);
});

test('long cycles are predicted as they are and flagged outside the normal range', () => {
  const a = analyzeCycleHistory([50, 52, 49, 51], 28);
  assert.equal(a.predictedCycleLength, 51); // median 50.5, not clamped to 45
  assert.equal(a.outsideNormalRange, true);
  assert.notEqual(a.confidence, 'high');
  // 42-day cycles are normal for a 15-year-old (21–45), not for an adult.
  assert.equal(analyzeCycleHistory([42, 42, 43], 28, { age: 15 }).outsideNormalRange, false);
  assert.equal(analyzeCycleHistory([42, 42, 43], 28, { age: 30 }).outsideNormalRange, true);
});

test('a 2-day unlogged gap inside a period does not split it', () => {
  const logs = [
    { dateKey: '2026-01-01', flow: 'heavy' },
    { dateKey: '2026-01-04', flow: 'light' },
  ];
  assert.deepEqual(derivePeriodEpisodes(logs), [{ startKey: '2026-01-01', endKey: '2026-01-04' }]);
});

test('even steady cycles get a ±2-day window', () => {
  const p = computeCyclePredictions(figoSettings, figoLogs, { today: atDay('2026-09-01') });
  assert.equal(p.predictedPeriodStartEarliestISO.slice(0, 10), '2026-09-19');
  assert.equal(p.predictedPeriodStartLatestISO.slice(0, 10), '2026-09-23');
});

test('a period longer than 8 days is flagged', () => {
  const logs = [...figoLogs, ...bleed('2026-09-21', 10)];
  const p = computeCyclePredictions(figoSettings, logs, { today: atDay('2026-10-01') });
  assert.equal(p.lastPeriodDays, 10);
  assert.equal(p.longPeriod, true);
});

test('one short bleed gap in a steady pattern is set aside, not called irregular', () => {
  // A 16-day gap among 30-day cycles is mid-cycle spotting far more often than a cycle.
  const a = analyzeCycleHistory([31, 30, 30, 30, 30, 16], 28);
  assert.equal(a.outliersRemoved, 1);
  assert.equal(a.isRegular, true);
  assert.equal(a.predictedCycleLength, 30);
});

test('irregular cycles get a window from the typical spread, not the single extreme', () => {
  const starts = ['2026-01-01'];
  [24, 35, 28, 40, 30, 26].forEach((l) => starts.push(shiftKey(starts.at(-1), l)));
  const p = computeCyclePredictions(
    { cycleLength: 28, periodLength: 5 },
    starts.flatMap((s) => bleed(s)),
    {
      today: new Date(`${shiftKey(starts.at(-1), 3)}T12:00:00.000Z`),
    },
  );
  assert.equal(p.isRegular, false);
  const radius = Math.round(
    (new Date(p.predictedPeriodStartLatestISO) - new Date(p.predictedPeriodStartEarliestISO)) /
      86400000 /
      2,
  );
  assert.ok(radius >= 3 && radius <= 11, `radius ${radius}`);
});
