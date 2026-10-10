/**
 * Structured prescriptions (`Consultation.rx`): what the doctor fills in on
 * the portal (complaints, diagnosis, a medicine table, investigations,
 * advice, follow-up), checked here, and its plain-text form, which still goes
 * in `Consultation.prescription` so the app's prescription card (and older
 * app builds) keep showing it. Pure, unit-tested.
 */

export const RX_LIMITS = {
  medicines: 20,
  complaints: 500,
  diagnosis: 500,
  investigations: 1000,
  advice: 1000,
  followUp: 80,
  medicine: { name: 120, dose: 40, frequency: 30, timing: 40, duration: 40, notes: 160 },
};

const MEDICINE_FIELDS = Object.keys(RX_LIMITS.medicine);
const TEXT_FIELDS = ['complaints', 'diagnosis', 'investigations', 'advice', 'followUp'];

const clean = (value) =>
  String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .trim();

/**
 * Validates and trims a structured prescription from a request body.
 * Returns `{ rx }` or `{ error }`. Empty medicine rows are dropped; at least
 * one medicine or some advice is required, so a blank form can't be "issued".
 */
export const cleanRx = (input) => {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Prescription details are missing' };
  }
  const rx = {};
  for (const field of TEXT_FIELDS) {
    const value = clean(input[field]);
    if (value.length > RX_LIMITS[field]) {
      return { error: `${labelOf(field)} must be ${RX_LIMITS[field]} characters or fewer` };
    }
    rx[field] = value;
  }

  if (input.medicines !== undefined && !Array.isArray(input.medicines)) {
    return { error: 'Medicines must be a list' };
  }
  const medicines = [];
  for (const [index, row] of (input.medicines || []).entries()) {
    if (!row || typeof row !== 'object') return { error: `Medicine ${index + 1} is not valid` };
    const medicine = {};
    for (const field of MEDICINE_FIELDS) {
      const value = clean(row[field]).replace(/\n+/g, ' ');
      if (value.length > RX_LIMITS.medicine[field]) {
        return {
          error: `Medicine ${index + 1}: ${field} must be ${RX_LIMITS.medicine[field]} characters or fewer`,
        };
      }
      medicine[field] = value;
    }
    if (!medicine.name) {
      if (MEDICINE_FIELDS.some((f) => medicine[f]))
        return { error: `Medicine ${index + 1} needs a name` };
      continue;
    }
    medicines.push(medicine);
  }
  if (medicines.length > RX_LIMITS.medicines) {
    return { error: `Add up to ${RX_LIMITS.medicines} medicines` };
  }
  rx.medicines = medicines;

  if (!medicines.length && !rx.advice && !rx.investigations) {
    return { error: 'Add at least one medicine, investigation or piece of advice' };
  }
  return { rx };
};

function labelOf(field) {
  return {
    complaints: 'Complaints',
    diagnosis: 'Diagnosis',
    investigations: 'Investigations',
    advice: 'Advice',
    followUp: 'Follow-up',
  }[field];
}

/** One medicine as a line: "TAB. FOLIC ACID 5 MG — 1 tab · 1-0-0 · After food · 30 days (note)". */
export const medicineLine = (m) => {
  const details = [m.dose, m.frequency, m.timing, m.duration].filter(Boolean).join(' · ');
  return `${m.name.toUpperCase()}${details ? ` — ${details}` : ''}${m.notes ? ` (${m.notes})` : ''}`;
};

/** The plain-text prescription stored in `Consultation.prescription`. */
export const rxToText = (rx) => {
  const blocks = [];
  if (rx.complaints) blocks.push(`Complaints: ${rx.complaints}`);
  if (rx.diagnosis) blocks.push(`Diagnosis: ${rx.diagnosis}`);
  if (rx.medicines?.length) {
    blocks.push(
      ['Medicines:', ...rx.medicines.map((m, i) => `${i + 1}. ${medicineLine(m)}`)].join('\n'),
    );
  }
  if (rx.investigations) blocks.push(`Investigations: ${rx.investigations}`);
  if (rx.advice) blocks.push(`Advice: ${rx.advice}`);
  if (rx.followUp) blocks.push(`Follow-up: ${rx.followUp}`);
  return blocks.join('\n\n');
};

/** "1-0-1" style doses: morning, afternoon, night counts, or null. */
export const parseDoseSchedule = (frequency) => {
  const match = /^\s*(\d+(?:\.\d+)?|½)\s*-\s*(\d+(?:\.\d+)?|½)\s*-\s*(\d+(?:\.\d+)?|½)\s*$/.exec(
    String(frequency || ''),
  );
  return match ? match.slice(1, 4) : null;
};
