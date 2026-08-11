import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateEligibility, buildEligibilityContext } from '../schemeEligibility.js';

const femaleOnlyBenefit = {
  name: 'PMMVY',
  eligibility: [
    { text: 'Pregnant and lactating women', field: 'gender', operator: 'eq', value: 'female' },
    { text: 'For the first living child' }, // descriptive only, no machine rule
  ],
};

const adolescentBenefit = {
  name: 'WIFS',
  eligibility: [{ text: 'Age 10-19', field: 'age', operator: 'lte', value: 19 }],
};

test('buildEligibilityContext derives age from dateOfBirth', () => {
  const dob = new Date(Date.now() - 15 * 365.25 * 24 * 60 * 60 * 1000).toISOString();
  const ctx = buildEligibilityContext({ dateOfBirth: dob });
  assert.equal(ctx.age, 15);
});

test('answers override profile values', () => {
  const ctx = buildEligibilityContext({ gender: 'female' }, { gender: 'male' });
  assert.equal(ctx.gender, 'male');
});

test('female user for a female-only scheme -> may_be_eligible', () => {
  const result = evaluateEligibility(femaleOnlyBenefit, { gender: 'female' });
  assert.equal(result.status, 'may_be_eligible');
  assert.match(result.message, /may be eligible/i);
  // Never claims guaranteed eligibility.
  assert.doesNotMatch(result.message, /you are eligible/i);
});

test('male user for a female-only scheme -> not_eligible', () => {
  const result = evaluateEligibility(femaleOnlyBenefit, { gender: 'male' });
  assert.equal(result.status, 'not_eligible');
  assert.equal(result.unmetCriteria.length, 1);
});

test('missing data never disqualifies (unknown, not fail)', () => {
  const result = evaluateEligibility(femaleOnlyBenefit, {});
  assert.equal(result.status, 'may_be_eligible');
  const genderCriterion = result.criteria.find((c) => c.text.includes('Pregnant'));
  assert.equal(genderCriterion.result, 'unknown');
});

test('descriptive-only criteria are marked unknown, not failed', () => {
  const result = evaluateEligibility(femaleOnlyBenefit, { gender: 'female' });
  const descriptive = result.criteria.find((c) => c.text === 'For the first living child');
  assert.equal(descriptive.result, 'unknown');
});

test('age lte rule: 15yo passes, 25yo fails', () => {
  assert.equal(evaluateEligibility(adolescentBenefit, {}, { age: 15 }).status, 'may_be_eligible');
  assert.equal(evaluateEligibility(adolescentBenefit, {}, { age: 25 }).status, 'not_eligible');
});

test('benefit with no rules is always may_be_eligible', () => {
  const result = evaluateEligibility({ name: 'JSSK', eligibility: [] }, {});
  assert.equal(result.status, 'may_be_eligible');
  assert.equal(result.criteria.length, 0);
});
