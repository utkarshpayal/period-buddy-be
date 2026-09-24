/**
 * Eligibility evaluation for Government Benefits.
 *
 * Design principle: we NEVER claim guaranteed eligibility. Machine rules only
 * ever downgrade the outcome to "not_eligible" when a hard criterion clearly
 * fails (e.g. a male user for a female-only scheme). Otherwise the best we say
 * is "may_be_eligible". A benefit with no machine rules is always
 * "may_be_eligible" — the user is pointed to the official source to confirm.
 */

const toAge = (dateOfBirth) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const diff = Date.now() - dob.getTime();
  return Math.floor(diff / (365.25 * 24 * 60 * 60 * 1000));
};

/**
 * Build the normalised profile the rules run against. `profile` is the User doc
 * fields; `answers` is the optional interactive checker input, which overrides
 * profile-derived values.
 */
export const buildEligibilityContext = (profile = {}, answers = {}) => ({
  gender: answers.gender ?? profile.gender ?? null,
  age: answers.age ?? toAge(profile.dateOfBirth),
  state: answers.state ?? profile.state ?? null,
  isPregnant: answers.isPregnant ?? null,
  hasChildren: answers.hasChildren ?? null,
});

/**
 * Evaluate one rule. Returns:
 *   'pass'    — the context clearly satisfies the rule
 *   'fail'    — the context clearly violates the rule (hard disqualifier)
 *   'unknown' — we don't have the data to decide (never disqualifies)
 */
const evaluateRule = (rule, ctx) => {
  if (!rule.field || !rule.operator) return 'unknown'; // descriptive-only criterion
  const actual = ctx[rule.field];
  if (actual === null || actual === undefined) return 'unknown';

  switch (rule.operator) {
    case 'eq':
      return String(actual).toLowerCase() === String(rule.value).toLowerCase() ? 'pass' : 'fail';
    case 'neq':
      return String(actual).toLowerCase() !== String(rule.value).toLowerCase() ? 'pass' : 'fail';
    case 'gte':
      return Number(actual) >= Number(rule.value) ? 'pass' : 'fail';
    case 'lte':
      return Number(actual) <= Number(rule.value) ? 'pass' : 'fail';
    case 'in':
      return Array.isArray(rule.value) && rule.value.map(String).includes(String(actual))
        ? 'pass'
        : 'fail';
    case 'exists':
      return actual !== null && actual !== undefined && actual !== '' ? 'pass' : 'fail';
    default:
      return 'unknown';
  }
};

/**
 * @returns {{
 *   status: 'may_be_eligible' | 'not_eligible',
 *   message: string,
 *   criteria: Array<{ text: string, result: 'pass'|'fail'|'unknown' }>,
 *   unmetCriteria: string[],
 * }}
 */
export const evaluateEligibility = (benefit, profile = {}, answers = {}) => {
  const ctx = buildEligibilityContext(profile, answers);
  const rules = Array.isArray(benefit.eligibility) ? benefit.eligibility : [];

  const criteria = rules.map((rule) => ({
    text: rule.text,
    result: evaluateRule(rule, ctx),
  }));

  const failed = criteria.filter((c) => c.result === 'fail');

  if (failed.length > 0) {
    return {
      status: 'not_eligible',
      message:
        'Based on your details you likely do not meet one or more criteria. Please confirm with the official source, as rules can change.',
      criteria,
      unmetCriteria: failed.map((c) => c.text),
    };
  }

  return {
    status: 'may_be_eligible',
    // Deliberately never "you are eligible".
    message:
      'You may be eligible. Eligibility is confirmed only by the official authority — please verify with the official source or your local health worker.',
    criteria,
    unmetCriteria: [],
  };
};
