/**
 * Government Schemes & Benefits — shared constants.
 *
 * Scope: women's reproductive & menstrual health only (periods, adolescent
 * girls' health, sexual & reproductive health, contraception/family planning,
 * pregnancy/antenatal, maternity/postpartum, mother/newborn care, maternal
 * nutrition). NOT general education/employment/entrepreneurship schemes.
 *
 * The architecture is state-independent: `governmentLevel` + `state` together
 * scope a benefit, so new states (Maharashtra, Gujarat, ...) can be seeded
 * later without any code change.
 */

// Health-domain categories a benefit can belong to (a benefit may span several).
export const SCHEME_CATEGORIES = [
  'menstrual_hygiene',
  'adolescent_health',
  'sexual_reproductive_health',
  'family_planning',
  'pregnancy_antenatal',
  'maternity_postpartum',
  'mother_newborn_care',
  'maternal_nutrition',
  'reproductive_health',
];

// Human-friendly labels + icons for the UI (Ionicons names).
export const SCHEME_CATEGORY_META = {
  menstrual_hygiene: { label: 'Menstrual Hygiene', icon: 'water-outline' },
  adolescent_health: { label: 'Adolescent Girls’ Health', icon: 'happy-outline' },
  sexual_reproductive_health: { label: 'Sexual & Reproductive Health', icon: 'heart-outline' },
  family_planning: { label: 'Family Planning', icon: 'people-outline' },
  pregnancy_antenatal: { label: 'Pregnancy & Antenatal Care', icon: 'medkit-outline' },
  maternity_postpartum: { label: 'Maternity & Postpartum', icon: 'woman-outline' },
  mother_newborn_care: { label: 'Mother & Newborn Care', icon: 'body-outline' },
  maternal_nutrition: { label: 'Maternal Nutrition', icon: 'nutrition-outline' },
  reproductive_health: { label: 'Reproductive Health', icon: 'pulse-outline' },
};

// Central vs. State. State benefits additionally carry a `state` value.
export const GOVERNMENT_LEVELS = ['central', 'state'];

// A benefit's primary call-to-action. NOT everything is an "apply" flow —
// e.g. JSSK is a facility-based entitlement (FIND_FACILITY), PMSMA is a
// monthly clinic day (FIND_FACILITY), awareness programmes are LEARN_MORE.
export const SCHEME_ACTION_TYPES = [
  'APPLY', // in-app eligibility form -> SchemeApplication
  'CHECK_ELIGIBILITY', // eligibility checker only, no application record
  'FIND_FACILITY', // entitlement delivered at a govt facility/hospital
  'LEARN_MORE', // informational / awareness programme
  'EXTERNAL_APPLICATION', // apply on an official external portal
];

export const SCHEME_TYPES = ['scheme', 'programme', 'service', 'entitlement'];

export const APPLICATION_STATUSES = [
  'draft',
  'submitted',
  'in_review',
  'approved',
  'rejected',
  'withdrawn',
];

// Eligibility rule operators used by GovernmentBenefit.eligibility[].rule
// (all optional — a benefit with no machine rules is always "may be eligible").
export const ELIGIBILITY_FIELDS = ['gender', 'age', 'isPregnant', 'state', 'hasChildren'];

export const isValidCategory = (c) => SCHEME_CATEGORIES.includes(c);
export const isValidGovernmentLevel = (l) => GOVERNMENT_LEVELS.includes(l);
