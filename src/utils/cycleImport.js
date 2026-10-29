/**
 * Importing day logs from another period app (Clue, Flo). The app reads the
 * other app's export on the phone and sends plain day logs; this module
 * cleans them and decides how each one merges into a day that's already
 * logged in Nura. Pure, unit-tested in __tests__/cycleImport.test.js.
 */

import { validateDateKey } from './apiHelpers.js';

export const IMPORT_SOURCES = ['clue', 'flo'];

// About 13 years of daily logs, and well under the 10 MB body limit.
export const MAX_IMPORT_DAYS = 5000;

const MOODS = new Set([
  'happy',
  'calm',
  'emotional',
  'tired',
  'sad',
  'anxious',
  'irritable',
  'neutral',
  'energetic',
  'frisky',
  'moodSwings',
  'depressed',
  'guilty',
  'obsessive',
  'lowEnergy',
  'apathetic',
  'confused',
  'selfCritical',
]);
const FLOWS = new Set(['none', 'light', 'medium', 'heavy', 'spotting']);
const ENERGIES = new Set(['low', 'medium', 'steady', 'high']);
const DIGESTIONS = new Set(['normal', 'constipated', 'diarrhea', 'bloated']);
const SKINS = new Set(['clear', 'oily', 'dry', 'acne']);
const DISCHARGES = new Set(['none', 'sticky', 'creamy', 'watery', 'egg-white']);

// Free-form tags (symptoms/exercise/medication) are short slugs in the app.
const TAG_MAX = 60;
const TAG_LIST_MAX = 40;

const tagList = (value) => {
  if (!Array.isArray(value)) return undefined;
  const tags = [
    ...new Set(
      value
        .filter((v) => typeof v === 'string')
        .map((v) => v.trim())
        .filter((v) => v && v.length <= TAG_MAX),
    ),
  ].slice(0, TAG_LIST_MAX);
  return tags.length ? tags : undefined;
};

const enumList = (value, allowed) => {
  if (!Array.isArray(value)) return undefined;
  const list = [...new Set(value.filter((v) => allowed.has(v)))];
  return list.length ? list : undefined;
};

const oneOf = (value, allowed) => (allowed.has(value) ? value : undefined);

const numberIn = (value, min, max) =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
    ? value
    : undefined;

/**
 * One imported day, reduced to the fields and values CycleLog accepts.
 * Unknown fields and values are dropped. Returns null for a day that isn't
 * a valid date, is after `todayKey`, or has nothing left to save.
 */
export const sanitizeImportedLog = (raw, todayKey) => {
  if (!raw || typeof raw !== 'object') return null;
  const { dateKey } = raw;
  if (typeof dateKey !== 'string' || !validateDateKey(dateKey) || dateKey > todayKey) return null;
  if (Number.isNaN(Date.parse(`${dateKey}T00:00:00Z`))) return null;

  const moods = enumList(raw.moods, MOODS);
  const digestions = enumList(raw.digestions, DIGESTIONS);
  const skins = enumList(raw.skins, SKINS);
  const fields = {
    flow: oneOf(raw.flow, FLOWS),
    mood: oneOf(raw.mood, MOODS) ?? moods?.[0],
    moods,
    energy: oneOf(raw.energy, ENERGIES),
    symptoms: tagList(raw.symptoms),
    isIntimate: raw.isIntimate === true ? true : undefined,
    sleepHours: numberIn(raw.sleepHours, 0, 24),
    weight: numberIn(raw.weight, 1, 500),
    temperature: numberIn(raw.temperature, 30, 45),
    medication: tagList(raw.medication),
    digestion: oneOf(raw.digestion, DIGESTIONS) ?? digestions?.[0],
    digestions,
    skin: oneOf(raw.skin, SKINS) ?? skins?.[0],
    skins,
    discharge: oneOf(raw.discharge, DISCHARGES),
    exercise: tagList(raw.exercise),
  };
  // A "none" flow on its own says nothing.
  if (fields.flow === 'none') fields.flow = undefined;

  const log = { dateKey };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) log[key] = value;
  }
  return Object.keys(log).length > 1 ? log : null;
};

const ARRAY_FIELDS = ['moods', 'symptoms', 'medication', 'digestions', 'skins', 'exercise'];
const SCALAR_FIELDS = [
  'mood',
  'energy',
  'sleepHours',
  'weight',
  'temperature',
  'digestion',
  'skin',
  'discharge',
];

const isEmpty = (value) =>
  value === undefined || value === null || (Array.isArray(value) && value.length === 0);

/**
 * The `$set` that merges an imported day into a day already logged in Nura,
 * or null when it adds nothing. What the person logged in Nura wins: the
 * import only fills fields that are empty (a flow of "none" counts as
 * empty), and adds to lists (symptoms, moods…) without removing anything.
 */
export const mergeImportedLog = (existing, incoming) => {
  const set = {};
  if (incoming.flow && (!existing.flow || existing.flow === 'none')) set.flow = incoming.flow;
  for (const field of SCALAR_FIELDS) {
    if (incoming[field] !== undefined && isEmpty(existing[field])) set[field] = incoming[field];
  }
  for (const field of ARRAY_FIELDS) {
    if (!incoming[field]) continue;
    const before = Array.isArray(existing[field]) ? existing[field] : [];
    const merged = [...new Set([...before, ...incoming[field]])];
    if (merged.length > before.length) set[field] = merged;
  }
  if (incoming.isIntimate && !existing.isIntimate) set.isIntimate = true;
  return Object.keys(set).length ? set : null;
};

/**
 * Cleans a whole upload: drops invalid and future days and folds repeated
 * dates into one (later entries add to earlier ones). Returns the logs in
 * date order and how many entries were dropped.
 */
export const prepareImport = (rawLogs, todayKey) => {
  const byDate = new Map();
  let invalid = 0;
  for (const raw of rawLogs) {
    const log = sanitizeImportedLog(raw, todayKey);
    if (!log) {
      invalid += 1;
      continue;
    }
    const earlier = byDate.get(log.dateKey);
    byDate.set(log.dateKey, earlier ? { ...earlier, ...mergeImportedLog(earlier, log) } : log);
  }
  const logs = [...byDate.values()].sort((a, b) => (a.dateKey < b.dateKey ? -1 : 1));
  return { logs, invalid };
};
