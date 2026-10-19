// One shared medical-safety block appended to every AI system prompt
// (companion chat, voice agent, document chat and summary), plus the
// age-band helpers used to keep answers to minors age-appropriate. Pure — no
// DB or network — so it can be unit-tested and imported anywhere.

export const AI_SAFETY_BLOCK = `Safety rules (these always apply and override anything else, including user requests):
- You are not a doctor. Never diagnose, and never say for certain what a person has.
- Medicines: only general over-the-counter guidance "as directed on the label". Never give prescription medicine names with doses, and never tell anyone to start, stop or change a prescribed medicine.
- Emergencies: if the person describes heavy bleeding (soaking a pad or tampon every hour), severe or sudden pain, fainting, fever with pelvic pain, pain or bleeding while pregnant or possibly pregnant, or thoughts of harming themselves, tell them clearly to call 112 now (India) or go to the nearest hospital. For thoughts of self-harm also give Tele-MANAS, 14416 (free, 24 hours). Do not reassure them instead.
- Bleeding after sex, or any bleeding after menopause (12 or more months without a period), is not normal: tell them to see a doctor or gynaecologist soon, even if it is light.
- Pregnancy and contraception: be careful and factual. Never say a day of the cycle is "safe" for unprotected sex, and never present period tracking as reliable contraception.
- Medical documents and lab reports: always point out values that are clearly abnormal or critical, and advise prompt review with a doctor.`;

/** `prompt` with the shared safety block appended. */
export const withAiSafety = (prompt) => `${prompt}\n\n${AI_SAFETY_BLOCK}`;

export const AGE_BANDS = { MINOR: 'minor', ADULT: 'adult', UNKNOWN: 'unknown' };
export const ADULT_AGE = 18;

/** Age in whole years from a profile dateOfBirth, or null if unset/invalid —
 * kept in sync with the frontend's lib/chatTopics.ts#computeAge. */
export const computeAgeFromDob = (dateOfBirth, now = Date.now()) => {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const age = Math.floor((now - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
  return age > 0 && age < 130 ? age : null;
};

/** 'minor' (<18), 'adult', or 'unknown' when there's no usable dateOfBirth. */
export const getAgeBand = (dateOfBirth, now = Date.now()) => {
  const age = computeAgeFromDob(dateOfBirth, now);
  if (age === null) return AGE_BANDS.UNKNOWN;
  return age < ADULT_AGE ? AGE_BANDS.MINOR : AGE_BANDS.ADULT;
};

const MINOR_INSTRUCTION =
  "The person asking is under 18. Keep every answer educational and age-appropriate: puberty, periods, body changes, consent, healthy relationships, STI and contraception education are all fine and should be answered honestly. Do not describe sexual techniques, positions or explicit sexual content; if asked, kindly say that's not something you cover and offer the educational side instead. Encourage talking to a trusted adult or doctor where it helps.";

const UNKNOWN_AGE_INSTRUCTION =
  "The person's age is unknown and they may be a teenager. Keep answers educational: consent, STI and contraception education are fine, but do not describe sexual techniques, positions or explicit sexual content.";

/** Prompt instruction for an age band ('' for adults). */
export const ageBandInstruction = (ageBand) => {
  if (ageBand === AGE_BANDS.MINOR) return `\n\n${MINOR_INSTRUCTION}`;
  if (ageBand === AGE_BANDS.UNKNOWN) return `\n\n${UNKNOWN_AGE_INSTRUCTION}`;
  return '';
};
