// Deterministic, educational screening questionnaires. NOT a diagnostic tool —
// every response and endpoint using this data must carry the disclaimer below.
// Question `type` is either:
//   - 'boolean': answer is true/false, full `weight` is scored when true
//   - 'scale':   answer is an integer 0-3, weight is scored proportionally
//                (answer / 3) * weight
// `redFlag: true` marks an answer that should be checked by a doctor whatever
// the total score (a 'boolean' answered yes, or a 'scale' answered at its max,
// 3) — see utils/screeningScoring.js. `redFlagReason` is the plain-language
// line added to the doctor-discussion summary.

export const SCREENING_DISCLAIMER =
  'This is an educational screening tool, not a medical diagnosis. Please consult a healthcare provider for proper evaluation.';

export const SCREENING_CONDITIONS = ['pcos', 'endometriosis', 'fibroid', 'thyroid'];

export const SCREENING_QUESTIONS = {
  pcos: [
    {
      id: 'pcos_irregular_cycles',
      text: 'Are your menstrual cycles irregular (shorter than 21 days or longer than 35 days, or unpredictable)?',
      type: 'boolean',
      weight: 25,
    },
    {
      id: 'pcos_missed_periods',
      text: 'Have you missed periods or gone several months without one, outside of pregnancy?',
      type: 'boolean',
      weight: 20,
    },
    {
      id: 'pcos_hirsutism',
      text: 'Have you noticed excess hair growth on your face, chest, or back?',
      type: 'boolean',
      weight: 20,
    },
    {
      id: 'pcos_acne',
      text: 'How would you rate your persistent acne or oily skin over the past 6 months?',
      type: 'scale',
      weight: 10,
    },
    {
      id: 'pcos_weight_change',
      text: 'Have you experienced unexplained weight gain or difficulty losing weight?',
      type: 'boolean',
      weight: 5,
    },
    {
      id: 'pcos_hair_thinning',
      text: 'Have you noticed thinning hair or hair loss on your scalp?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'pcos_family_history',
      text: 'Does anyone in your immediate family have PCOS or type 2 diabetes?',
      type: 'boolean',
      weight: 5,
    },
    {
      id: 'pcos_skin_darkening',
      text: 'Have you noticed dark, velvety patches of skin (neck, armpits, or groin)?',
      type: 'boolean',
      weight: 5,
    },
  ],
  endometriosis: [
    {
      id: 'endo_pelvic_pain',
      text: 'How severe is your pelvic pain during periods, on a scale of none to severe?',
      type: 'scale',
      weight: 20,
      redFlag: true,
      redFlagReason: 'Severe period pain',
    },
    {
      id: 'endo_pain_worsening',
      text: 'Has your period pain gotten progressively worse over time?',
      type: 'boolean',
      weight: 15,
    },
    {
      id: 'endo_pain_beyond_period',
      text: 'Do you experience pelvic pain outside of your period days?',
      type: 'boolean',
      weight: 15,
      redFlag: true,
      redFlagReason: 'Pelvic pain outside your period',
    },
    {
      id: 'endo_pain_intercourse',
      text: 'Do you experience pain during or after intercourse?',
      type: 'boolean',
      weight: 15,
      redFlag: true,
      redFlagReason: 'Pain during or after sex',
    },
    {
      id: 'endo_heavy_bleeding',
      text: 'Do you have heavy menstrual bleeding or bleeding between periods?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'endo_gi_symptoms',
      text: 'Do you experience painful bowel movements, bloating, or GI discomfort around your period?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'endo_fertility_difficulty',
      text: 'Have you had difficulty conceiving, if you have tried?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'endo_family_history',
      text: 'Does anyone in your immediate family have endometriosis?',
      type: 'boolean',
      weight: 5,
    },
  ],
  fibroid: [
    {
      id: 'fibroid_heavy_bleeding',
      text: 'How heavy is your menstrual flow, on a scale of light to very heavy?',
      type: 'scale',
      weight: 20,
      redFlag: true,
      redFlagReason: 'Very heavy menstrual flow',
    },
    {
      id: 'fibroid_prolonged_periods',
      text: 'Do your periods last longer than 7 days?',
      type: 'boolean',
      weight: 15,
    },
    {
      id: 'fibroid_pelvic_pressure',
      text: 'Do you feel pelvic pressure, fullness, or bloating unrelated to eating?',
      type: 'boolean',
      weight: 15,
    },
    {
      id: 'fibroid_frequent_urination',
      text: 'Have you noticed frequent urination or trouble emptying your bladder fully?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'fibroid_backache',
      text: 'Do you experience lower back pain or leg pain around your cycle?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'fibroid_pain_intercourse',
      text: 'Do you experience pain during intercourse?',
      type: 'boolean',
      weight: 10,
      redFlag: true,
      redFlagReason: 'Pain during sex',
    },
    {
      id: 'fibroid_anemia_symptoms',
      text: 'Have you felt unusually tired, dizzy, or short of breath, possibly from heavy blood loss?',
      type: 'boolean',
      weight: 10,
      redFlag: true,
      redFlagReason: 'Tiredness or breathlessness that may mean anaemia (low iron)',
    },
    {
      id: 'fibroid_family_history',
      text: 'Does anyone in your immediate family have uterine fibroids?',
      type: 'boolean',
      weight: 10,
    },
  ],
  thyroid: [
    {
      id: 'thyroid_fatigue',
      text: 'How often do you feel unusually fatigued or low on energy?',
      type: 'scale',
      weight: 15,
    },
    {
      id: 'thyroid_weight_change',
      text: 'Have you had unexplained weight gain or weight loss recently?',
      type: 'boolean',
      weight: 15,
    },
    {
      id: 'thyroid_cycle_changes',
      text: 'Have your periods become heavier, lighter, or more irregular recently?',
      type: 'boolean',
      weight: 15,
    },
    {
      id: 'thyroid_temperature_sensitivity',
      text: 'Do you feel unusually sensitive to cold or heat compared to others?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'thyroid_hair_skin_changes',
      text: 'Have you noticed hair thinning, dry skin, or brittle nails?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'thyroid_mood_changes',
      text: 'Have you experienced new anxiety, depression, or mood swings?',
      type: 'boolean',
      weight: 10,
    },
    {
      id: 'thyroid_neck_swelling',
      text: 'Have you noticed any swelling or lump in the front of your neck?',
      type: 'boolean',
      weight: 15,
      redFlag: true,
      redFlagReason: 'A lump or swelling in the front of the neck',
    },
    {
      id: 'thyroid_family_history',
      text: 'Does anyone in your immediate family have a thyroid condition?',
      type: 'boolean',
      weight: 10,
    },
  ],
};

export const RISK_THRESHOLDS = {
  LOW_MAX: 33,
  MODERATE_MAX: 66,
};

export const getRiskLevel = (score) => {
  if (score < RISK_THRESHOLDS.LOW_MAX) return 'low';
  if (score <= RISK_THRESHOLDS.MODERATE_MAX) return 'moderate';
  return 'high';
};

// Any red-flag answer (see `redFlag` above) lifts the result to at least this
// level — "talk to a doctor" — however low the weighted score is.
export const RED_FLAG_MIN_RISK = 'moderate';

const RISK_ORDER = ['low', 'moderate', 'high'];

/** The higher of two risk levels. */
export const maxRiskLevel = (a, b) =>
  RISK_ORDER[Math.max(RISK_ORDER.indexOf(a), RISK_ORDER.indexOf(b), 0)];

// Rotterdam criteria: ovulatory dysfunction (irregular / absent periods) plus
// clinical hyperandrogenism. Both present → at least 'moderate'.
export const PCOS_OVULATORY_IDS = ['pcos_irregular_cycles', 'pcos_missed_periods'];
export const PCOS_ANDROGEN_IDS = ['pcos_hirsutism', 'pcos_acne', 'pcos_hair_thinning'];

// 2023 International PCOS Guideline: adult criteria don't apply within ~8
// years of the first period, when irregular cycles and acne are common.
export const PCOS_TEEN_NOTE =
  "If you're under 18 or had your first period less than about 8 years ago, adult PCOS criteria don't apply: irregular cycles and acne are common in the teen years. A doctor may suggest watching how things change over time before giving any diagnosis.";

// Age (years) below which the teen caveat is shown: ~8 years after an average
// first period at 12.
export const PCOS_TEEN_NOTE_MAX_AGE = 20;
