// Pure helpers for the outbound "Buddy" check-in call (samvaadClient.js +
// voiceAgentController.js's checkinCallWebhook), kept free of I/O so they
// can be unit tested.

// The user base is India-only and the Sarvam agent's log tool already sends
// a static `timezoneOffsetMinutes: -330`, so a call's "today" is IST, not the
// server's UTC. A 1am IST call would otherwise log against yesterday.
export const IST_OFFSET_MINUTES = 330;

const DAY_MS = 24 * 60 * 60 * 1000;

export const checkinDateKey = (now = new Date()) =>
  new Date(now.getTime() + IST_OFFSET_MINUTES * 60000).toISOString().slice(0, 10);

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const weekdayOf = (dateKey) => WEEKDAYS[new Date(`${dateKey}T00:00:00Z`).getUTCDay()];

/**
 * Plain-English period timing the agent can say out loud, so the LLM never
 * has to do date arithmetic itself (it gets that wrong often enough on a
 * live call to matter). Returns '' when there's no prediction.
 */
export const describePeriodTiming = (expectedDateKey, todayKey) => {
  if (!expectedDateKey || !todayKey) return '';
  const diff = Math.round(
    (new Date(`${expectedDateKey}T00:00:00Z`) - new Date(`${todayKey}T00:00:00Z`)) / DAY_MS,
  );
  if (!Number.isFinite(diff)) return '';
  if (diff === 0) return 'expected today';
  if (diff === 1) return 'expected tomorrow';
  if (diff > 1) return `expected in ${diff} days`;
  if (diff === -1) return 'was expected yesterday, about 1 day late';
  return `was expected ${-diff} days ago, about ${-diff} days late`;
};

// Post-call variables on the Sarvam agent are named after these CycleLog
// fields on purpose, so the webhook can save them without a mapping table.
export const CHECKIN_BACKFILL_FIELDS = [
  'flow',
  'mood',
  'energy',
  'symptoms',
  'sleepHours',
  'waterIntake',
  'stressLevel',
  'digestion',
  'skin',
  'exercise',
  'medication',
  'weight',
  'temperature',
];

// What the agent's post-call extraction writes for a topic that never came
// up. upsertCycleLog strips 'not_discussed' itself; the rest would otherwise
// be stored as a literal symptom/medication/exercise.
const PLACEHOLDERS = new Set(['', 'not_discussed', 'none reported', 'unknown', 'n/a', 'na']);

// For the free-text list fields "none" means "nothing to log". It can't be a
// placeholder everywhere, because `flow: 'none'` is a real value.
const LIST_FIELDS = new Set(['symptoms', 'exercise', 'medication']);
const LIST_NONE = new Set(['none', 'nothing', 'no']);

const isBlank = (value, field) =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && PLACEHOLDERS.has(value.trim().toLowerCase())) ||
  (typeof value === 'string' &&
    LIST_FIELDS.has(field) &&
    LIST_NONE.has(value.trim().toLowerCase())) ||
  (Array.isArray(value) && value.length === 0);

/**
 * The webhook is the backup path: the agent's in-call `log_cycle_entry`
 * tool is what normally saves the check-in. So from the call's final
 * variables, keep only the fields today's log doesn't already have. A value
 * the tool (or the user in the app) already saved always wins.
 *
 * Returns {} when there is nothing to add. `symptoms` is carried over from
 * the existing log when not being filled, because upsertCycleLog treats a
 * missing `symptoms` as an empty list and would otherwise wipe it.
 */
export const buildCheckinBackfill = (finalVars, existingLog) => {
  if (!finalVars || typeof finalVars !== 'object') return {};
  const payload = {};
  for (const field of CHECKIN_BACKFILL_FIELDS) {
    const value = finalVars[field];
    if (isBlank(value, field)) continue;
    if (existingLog && !isBlank(existingLog[field], field)) continue;
    payload[field] = value;
  }
  if (Object.keys(payload).length === 0) return {};
  if (!('symptoms' in payload) && existingLog?.symptoms?.length) {
    payload.symptoms = existingLog.symptoms;
  }
  return payload;
};
