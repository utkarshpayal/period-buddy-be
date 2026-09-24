import { computeCyclePredictions, CYCLE_PHASES } from './cycle.js';

/**
 * Buddy compatibility scoring.
 *
 * The goal of a Period Buddy match is two people whose cycles run close enough
 * that they're likely in similar phases at similar times — so the score rewards
 * matching cycle length, matching period length, and being in (or near) the
 * same current phase, with a small bonus for both being active loggers.
 *
 * Scoring is deterministic and symmetric: score(a, b) === score(b, a). It never
 * claims a perfect match (capped below 100) and never bottoms out (floored), so
 * even sparse-data users still get a plausible, non-zero card.
 */

const SCORE_FLOOR = 55;
const SCORE_CEIL = 99;

// Phases form a cycle; distance between two phases is the shorter way around the
// ring (period → follicular → ovulation → luteal → period). 0 = same phase,
// max = 2 (opposite phases).
const phaseDistance = (a, b) => {
  const ia = CYCLE_PHASES.indexOf(a);
  const ib = CYCLE_PHASES.indexOf(b);
  if (ia < 0 || ib < 0) return 1;
  const raw = Math.abs(ia - ib);
  return Math.min(raw, CYCLE_PHASES.length - raw);
};

const titleCasePhase = (phase) => {
  if (!phase) return 'Cycle';
  return phase.charAt(0).toUpperCase() + phase.slice(1);
};

const daysSince = (date) => {
  if (!date) return Infinity;
  return (Date.now() - new Date(date).getTime()) / (1000 * 60 * 60 * 24);
};

/**
 * @param {object|null} aSettings CycleSettings for user A (the viewer)
 * @param {object|null} bSettings CycleSettings for user B (the candidate)
 * @param {object} [opts]
 * @param {Date} [opts.aLastActive] A's last activity, for the recency bonus
 * @param {Date} [opts.bLastActive] B's last activity, for the recency bonus
 * @returns {{ compatibility: number, cycleOverlapDays: number, similarities: string[],
 *            samePhase: boolean, candidatePhaseLabel: string }}
 */
export const scoreBuddyCompatibility = (aSettings, bSettings, opts = {}) => {
  const aPred = aSettings ? computeCyclePredictions(aSettings) : null;
  const bPred = bSettings ? computeCyclePredictions(bSettings) : null;

  const aCycle = aSettings?.cycleLength ?? 28;
  const bCycle = bSettings?.cycleLength ?? 28;
  const aPeriod = aSettings?.periodLength ?? 5;
  const bPeriod = bSettings?.periodLength ?? 5;

  const cycleDelta = Math.abs(aCycle - bCycle);
  const periodDelta = Math.abs(aPeriod - bPeriod);
  const dist = aPred && bPred ? phaseDistance(aPred.currentPhase, bPred.currentPhase) : 1;
  const samePhase = dist === 0;

  // Recency bonus: both people logging within the last week keeps the space
  // lively, so nudge those matches up a little.
  const bothActive = daysSince(opts.aLastActive) <= 7 && daysSince(opts.bLastActive) <= 7;

  const raw = 100 - cycleDelta * 2.5 - periodDelta * 1.5 - dist * 6 + (bothActive ? 3 : 0);
  const compatibility = Math.round(Math.max(SCORE_FLOOR, Math.min(SCORE_CEIL, raw)));

  const cycleOverlapDays = Math.max(0, 28 - cycleDelta);

  const similarities = [
    `${bCycle}-Day Cycle`,
    samePhase ? 'Same Current Phase' : dist === 1 ? 'Adjacent Cycle Phase' : 'Nearby Cycle Pattern',
    periodDelta <= 1 ? 'Similar Period Length' : 'Private Wellness Tracking',
  ];

  return {
    compatibility,
    cycleOverlapDays,
    similarities,
    samePhase,
    candidatePhaseLabel: `${titleCasePhase(bPred?.currentPhase)} Phase`,
  };
};
