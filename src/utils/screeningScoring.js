// Pure scoring for the screening questionnaires (constants/screeningQuestions.js)
// — no DB, no AI — so the red-flag and PCOS rules can be unit-tested.
import {
  PCOS_ANDROGEN_IDS,
  PCOS_OVULATORY_IDS,
  PCOS_TEEN_NOTE,
  PCOS_TEEN_NOTE_MAX_AGE,
  RED_FLAG_MIN_RISK,
  getRiskLevel,
  maxRiskLevel,
} from '../constants/screeningQuestions.js';
import { computeAgeFromDob } from './aiSafety.js';

const SCALE_MAX = 3;

// App builds before this fix rendered 'boolean' questions with the 0-3 scale
// buttons, so any positive number counts as yes (it used to be only 1, which
// scored "Severe" (3) as no).
const booleanAnswer = (raw) =>
  raw === true || raw === 'true' || (typeof raw === 'number' && raw > 0);
const scaleAnswer = (raw) => Math.min(SCALE_MAX, Math.max(0, Number(raw) || 0));

/** True when this answer counts towards the condition (yes, or scale ≥ 2). */
const isPositive = (question, raw) =>
  question.type === 'scale' ? scaleAnswer(raw) >= 2 : booleanAnswer(raw);

/** True when this answer is a red flag: a yes, or a scale answered at its max. */
const isRedFlag = (question, raw) => {
  if (!question.redFlag) return false;
  return question.type === 'scale' ? scaleAnswer(raw) === SCALE_MAX : booleanAnswer(raw);
};

/**
 * Deterministic weighted-sum scoring. Each question's `weight` is fully
 * scored for a truthy boolean answer, or proportionally scored (answer / 3)
 * for a 0-3 scale answer.
 */
export const scoreAnswers = (questions, answers) => {
  let earned = 0;
  let possible = 0;
  const drivers = [];

  questions.forEach((question) => {
    possible += question.weight;
    const raw = answers?.[question.id];

    if (question.type === 'boolean') {
      if (booleanAnswer(raw)) {
        earned += question.weight;
        drivers.push({ text: question.text, contributed: question.weight });
      }
    } else if (question.type === 'scale') {
      const value = scaleAnswer(raw);
      const contributed = (value / SCALE_MAX) * question.weight;
      earned += contributed;
      if (value >= 2) {
        drivers.push({ text: question.text, contributed: Math.round(contributed) });
      }
    }
  });

  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  return { score, drivers };
};

/** Red-flag questions answered positively, in question order. */
export const findRedFlags = (questions, answers) =>
  questions.filter((question) => isRedFlag(question, answers?.[question.id]));

/** Rotterdam pattern: irregular/absent periods plus a sign of high androgens. */
export const hasPcosRotterdamPattern = (questions, answers) => {
  const positive = (ids) =>
    questions.some((q) => ids.includes(q.id) && isPositive(q, answers?.[q.id]));
  return positive(PCOS_OVULATORY_IDS) && positive(PCOS_ANDROGEN_IDS);
};

/** Teen caveat for PCOS: shown when the user is young, or their age is unknown. */
export const pcosTeenNote = (dateOfBirth, now = Date.now()) => {
  const age = computeAgeFromDob(dateOfBirth, now);
  return age === null || age < PCOS_TEEN_NOTE_MAX_AGE ? PCOS_TEEN_NOTE : null;
};

/**
 * Full assessment for one condition: weighted score, then the safety floors.
 * Any red-flag answer lifts the level to at least RED_FLAG_MIN_RISK
 * ("talk to a doctor"), as does the PCOS Rotterdam pattern, whatever the score.
 */
export const assessScreening = (condition, questions, answers, { dateOfBirth, now } = {}) => {
  const { score, drivers } = scoreAnswers(questions, answers);
  const redFlagQuestions = findRedFlags(questions, answers);

  let riskLevel = getRiskLevel(score);
  if (redFlagQuestions.length) riskLevel = maxRiskLevel(riskLevel, RED_FLAG_MIN_RISK);
  const rotterdamPattern =
    condition === 'pcos' ? hasPcosRotterdamPattern(questions, answers) : false;
  if (rotterdamPattern) riskLevel = maxRiskLevel(riskLevel, 'moderate');

  return {
    score,
    drivers,
    riskLevel,
    redFlags: redFlagQuestions.map((q) => q.id),
    redFlagReasons: redFlagQuestions.map((q) => q.redFlagReason || q.text),
    rotterdamPattern,
    note: condition === 'pcos' ? pcosTeenNote(dateOfBirth, now) : null,
  };
};
