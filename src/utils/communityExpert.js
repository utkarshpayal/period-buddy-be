/**
 * Gynecologist answers on community posts. A doctor answers from the
 * Clinician portal (doctorCommunityController); the comment carries an
 * `expert` block, and the app shows it as "Medically verified" with the
 * doctor's name, or as "Verified gynaecologist" when the doctor chose not to
 * show it. Pure, unit-tested in __tests__/communityExpert.test.js.
 */

/** What the app shows when the doctor hides their name. */
export const VERIFIED_LABEL = 'Verified gynaecologist';

/** "Priya Sharma" → "Dr. Priya Sharma"; a name that already starts with Dr is kept. */
export const doctorDisplayName = (name) => {
  const clean = String(name ?? '').trim();
  if (!clean) return '';
  return /^dr\.?\s/i.test(clean) ? clean.replace(/^dr\.?\s+/i, 'Dr. ') : `Dr. ${clean}`;
};

/** The `expert` block stored on an answer, copied from the Doctor profile. */
export const expertSnapshot = (doctor, showName) => ({
  doctorId: doctor._id,
  name: doctorDisplayName(doctor.name),
  specialty: doctor.specialty || undefined,
  avatarUrl: doctor.avatarUrl || undefined,
  showName: showName === true,
});

export const isExpertComment = (comment) => Boolean(comment?.expert?.doctorId);

/**
 * The `expert` block clients get. The doctor id never leaves the server, and
 * the name and photo only when the doctor chose to show them.
 */
export const publicExpert = (expert) => {
  const showName = expert.showName === true && Boolean(expert.name);
  return {
    verified: true,
    showName,
    name: showName ? expert.name : null,
    specialty: expert.specialty || null,
    avatarUrl: showName ? expert.avatarUrl || null : null,
  };
};

/** Stands in for the populated user on an expert answer, for clients that read `userId`. */
export const expertAuthor = (expert) => {
  const shown = publicExpert(expert);
  return { firstName: shown.name ?? VERIFIED_LABEL, lastName: '', profilePicture: shown.avatarUrl };
};

export const countExpertAnswers = (comments) => (comments || []).filter(isExpertComment).length;
