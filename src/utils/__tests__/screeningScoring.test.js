import test from 'node:test';
import assert from 'node:assert/strict';
import { SCREENING_QUESTIONS, PCOS_TEEN_NOTE } from '../../constants/screeningQuestions.js';
import {
  assessScreening,
  hasPcosRotterdamPattern,
  pcosTeenNote,
  scoreAnswers,
} from '../screeningScoring.js';

const NOW = new Date('2026-10-18T00:00:00Z').getTime();
const ADULT_DOB = '1990-01-01';
const assess = (condition, answers, options = { dateOfBirth: ADULT_DOB, now: NOW }) =>
  assessScreening(condition, SCREENING_QUESTIONS[condition], answers, options);

test('no answers is low with no red flags', () => {
  const result = assess('fibroid', {});
  assert.equal(result.riskLevel, 'low');
  assert.deepEqual(result.redFlags, []);
});

test('fibroids: very heavy flow + anaemia symptoms is at least moderate despite a low score', () => {
  const result = assess('fibroid', { fibroid_heavy_bleeding: 3, fibroid_anemia_symptoms: true });
  assert.ok(result.score < 33, `score ${result.score} should be under the low cut-off`);
  assert.equal(result.riskLevel, 'moderate');
  assert.deepEqual(result.redFlags, ['fibroid_heavy_bleeding', 'fibroid_anemia_symptoms']);
});

test('fibroids: heavy (not max) flow alone is not a red flag', () => {
  const result = assess('fibroid', { fibroid_heavy_bleeding: 2 });
  assert.deepEqual(result.redFlags, []);
  assert.equal(result.riskLevel, 'low');
});

test('thyroid: neck lump alone is at least moderate', () => {
  const result = assess('thyroid', { thyroid_neck_swelling: true });
  assert.equal(result.riskLevel, 'moderate');
  assert.deepEqual(result.redFlags, ['thyroid_neck_swelling']);
});

test('endometriosis: severe period pain alone is at least moderate', () => {
  const result = assess('endometriosis', { endo_pelvic_pain: 3 });
  assert.equal(result.riskLevel, 'moderate');
  assert.deepEqual(result.redFlags, ['endo_pelvic_pain']);
});

test('endometriosis: pain outside periods alone is at least moderate', () => {
  const result = assess('endometriosis', { endo_pain_beyond_period: 'true' });
  assert.equal(result.riskLevel, 'moderate');
  assert.deepEqual(result.redFlags, ['endo_pain_beyond_period']);
});

test('red flags never lower a high score', () => {
  const answers = Object.fromEntries(
    SCREENING_QUESTIONS.endometriosis.map((q) => [q.id, q.type === 'scale' ? 3 : true]),
  );
  assert.equal(assess('endometriosis', answers).riskLevel, 'high');
});

test('PCOS weights add up to 100 and Rotterdam features dominate', () => {
  const total = SCREENING_QUESTIONS.pcos.reduce((sum, q) => sum + q.weight, 0);
  assert.equal(total, 100);
  const lifestyle = assess('pcos', {
    pcos_weight_change: true,
    pcos_family_history: true,
    pcos_skin_darkening: true,
  });
  assert.equal(lifestyle.riskLevel, 'low');
});

test('PCOS: irregular cycles + hirsutism reach at least moderate', () => {
  const result = assess('pcos', { pcos_irregular_cycles: true, pcos_hirsutism: true });
  assert.ok(result.score >= 33);
  assert.equal(result.riskLevel, 'moderate');
  assert.equal(result.rotterdamPattern, true);
});

test('PCOS: missed periods + acne (scale) is the Rotterdam pattern', () => {
  const questions = SCREENING_QUESTIONS.pcos;
  assert.equal(
    hasPcosRotterdamPattern(questions, { pcos_missed_periods: true, pcos_acne: 2 }),
    true,
  );
  assert.equal(
    hasPcosRotterdamPattern(questions, { pcos_missed_periods: true, pcos_acne: 1 }),
    false,
  );
  assert.equal(hasPcosRotterdamPattern(questions, { pcos_hirsutism: true }), false);
  assert.equal(assess('pcos', { pcos_missed_periods: true, pcos_acne: 2 }).riskLevel, 'moderate');
});

test('PCOS teen caveat: shown for teens and unknown age, not for adults', () => {
  assert.equal(pcosTeenNote('2010-05-01', NOW), PCOS_TEEN_NOTE);
  assert.equal(pcosTeenNote(null, NOW), PCOS_TEEN_NOTE);
  assert.equal(pcosTeenNote(ADULT_DOB, NOW), null);
  assert.equal(assess('pcos', {}, { now: NOW }).note, PCOS_TEEN_NOTE);
  assert.equal(assess('thyroid', {}, { now: NOW }).note, null);
});

test('scoreAnswers keeps the weighted-sum contract', () => {
  const questions = [
    { id: 'a', type: 'boolean', weight: 50 },
    { id: 'b', type: 'scale', weight: 50 },
  ];
  assert.deepEqual(scoreAnswers(questions, { a: true, b: 3 }).score, 100);
  assert.deepEqual(scoreAnswers(questions, { a: false, b: 0 }).score, 0);
  assert.deepEqual(scoreAnswers(questions, { a: 1, b: 9 }).score, 100);
});

test('boolean questions answered on the old 0-3 scale count any positive value as yes', () => {
  const severe = assess('thyroid', { thyroid_neck_swelling: 3 });
  assert.deepEqual(severe.redFlags, ['thyroid_neck_swelling']);
  assert.equal(severe.riskLevel, 'moderate');
  assert.deepEqual(assess('thyroid', { thyroid_neck_swelling: 0 }).redFlags, []);
});
