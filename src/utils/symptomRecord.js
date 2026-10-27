/**
 * Body Map symptom records — pure helpers (no DB, unit-tested in
 * __tests__/symptomRecord.test.js). The model is models/SymptomRecord.js, the
 * controller controllers/symptomRecordController.js.
 *
 * A record is one symptom the person placed on the app's body map: where
 * (a stable region id and side), how bad (1–10), since when, and how often.
 * It is self-reported and never a diagnosis. Region ids are stable keys
 * independent of their labels and are mirrored in the app's
 * lib/bodyRegions.ts; add a region in both places.
 */
import { DATE_KEY_REGEX } from './apiHelpers.js';

/** Region id → the sides a record there may name. */
export const BODY_REGIONS = {
  head: ['center'],
  face: ['center'],
  neck: ['center'],
  chest: ['center'],
  breast: ['left', 'right', 'both'],
  upper_abdomen: ['center'],
  lower_abdomen: ['center', 'left', 'right', 'both'],
  pelvis: ['center'],
  genital: ['center'],
  upper_back: ['center'],
  lower_back: ['center', 'left', 'right', 'both'],
  buttock: ['left', 'right', 'both'],
  shoulder: ['left', 'right', 'both'],
  arm: ['left', 'right', 'both'],
  hand: ['left', 'right', 'both'],
  hip: ['left', 'right', 'both'],
  thigh: ['left', 'right', 'both'],
  knee: ['left', 'right', 'both'],
  lower_leg: ['left', 'right', 'both'],
  foot: ['left', 'right', 'both'],
  whole_body: ['center'],
};
export const BODY_REGION_IDS = Object.keys(BODY_REGIONS);
export const SIDES = ['center', 'left', 'right', 'both'];
export const STATUSES = ['active', 'resolved'];
export const FREQUENCIES = ['once', 'occasional', 'daily', 'weekly', 'cyclical', 'constant'];

export const SYMPTOM_KEY_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SYMPTOM_KEY_MAX = 40;
export const CUSTOM_NAME_MAX = 60;
export const NOTE_MAX = 1000;
export const ASSOCIATED_MAX = 10;
export const SEVERITY_MIN = 1;
export const SEVERITY_MAX = 10;
/** Most records one account may hold; past this the person deletes old ones. */
export const MAX_RECORDS_PER_USER = 500;

const isKey = (v) =>
  typeof v === 'string' && v.length <= SYMPTOM_KEY_MAX && SYMPTOM_KEY_REGEX.test(v);

const cleanLine = (value, max) =>
  typeof value === 'string'
    ? value
        .replace(/[\r\n\t]+/g, ' ')
        .trim()
        .slice(0, max)
    : '';

const cleanText = (value, max) =>
  typeof value === 'string' ? value.replace(/\r\n/g, '\n').trim().slice(0, max) : '';

/** Default side when none is given: the only one, else `both`. */
export const defaultSide = (regionId) => {
  const sides = BODY_REGIONS[regionId] ?? [];
  return sides.length === 1 ? sides[0] : 'both';
};

/** `?status=` filter: active, resolved, or null for all. */
export const parseStatusFilter = (raw) => (STATUSES.includes(raw) ? raw : null);

/**
 * Validates a create (`partial: false`) or update (`partial: true`) body.
 * `current` is the stored record for an update, so cross-field rules
 * (side vs region, resolved after onset) see the merged result. Unknown
 * keys are ignored. Returns { value } or { error }.
 */
export const parseSymptomRecordInput = (
  body,
  { partial = false, todayKey, current = null } = {},
) => {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'Invalid body' };
  const has = (k) => Object.prototype.hasOwnProperty.call(body, k) && body[k] !== undefined;
  const out = {};

  if (has('symptomKey') || !partial) {
    if (!isKey(body.symptomKey)) return { error: 'symptomKey must be a short lowercase slug' };
    out.symptomKey = body.symptomKey;
  }
  if (has('customName')) {
    out.customName = body.customName === null ? '' : cleanLine(body.customName, CUSTOM_NAME_MAX);
  }
  const symptomKey = out.symptomKey ?? current?.symptomKey;
  const customName = out.customName ?? current?.customName ?? '';
  if (symptomKey === 'other' && !customName) return { error: 'Name the symptom' };

  if (has('regionId') || !partial) {
    if (!BODY_REGION_IDS.includes(body.regionId)) return { error: 'Unknown body region' };
    out.regionId = body.regionId;
  }
  if (has('side')) {
    if (!SIDES.includes(body.side)) return { error: 'side must be center, left, right or both' };
    out.side = body.side;
  }
  const regionId = out.regionId ?? current?.regionId;
  if (out.regionId && !out.side && current?.regionId !== out.regionId)
    out.side = defaultSide(regionId);
  if (!partial && !out.side) out.side = defaultSide(regionId);
  const side = out.side ?? current?.side;
  if (!BODY_REGIONS[regionId]?.includes(side))
    return { error: 'That side does not apply to this region' };

  if (has('severity') || !partial) {
    const n = Number(body.severity);
    if (!Number.isInteger(n) || n < SEVERITY_MIN || n > SEVERITY_MAX) {
      return { error: `severity must be a whole number from ${SEVERITY_MIN} to ${SEVERITY_MAX}` };
    }
    out.severity = n;
  }

  if (has('onsetDate') || !partial) {
    if (!DATE_KEY_REGEX.test(String(body.onsetDate ?? '')))
      return { error: 'onsetDate must be YYYY-MM-DD' };
    if (todayKey && body.onsetDate > todayKey)
      return { error: 'onsetDate cannot be in the future' };
    out.onsetDate = body.onsetDate;
  }

  if (has('status')) {
    if (!STATUSES.includes(body.status)) return { error: 'status must be active or resolved' };
    out.status = body.status;
  } else if (!partial) out.status = 'active';

  if (has('resolvedDate')) {
    if (body.resolvedDate === null) out.resolvedDate = null;
    else if (!DATE_KEY_REGEX.test(String(body.resolvedDate)))
      return { error: 'resolvedDate must be YYYY-MM-DD' };
    else if (todayKey && body.resolvedDate > todayKey)
      return { error: 'resolvedDate cannot be in the future' };
    else out.resolvedDate = body.resolvedDate;
  }
  const status = out.status ?? current?.status ?? 'active';
  if (!partial || has('status') || has('resolvedDate')) {
    if (status === 'active') out.resolvedDate = null;
    else if (!(out.resolvedDate ?? current?.resolvedDate)) out.resolvedDate = todayKey ?? null;
  }
  const onset = out.onsetDate ?? current?.onsetDate;
  const resolved = out.resolvedDate === undefined ? current?.resolvedDate : out.resolvedDate;
  if (resolved && onset && resolved < onset)
    return { error: 'resolvedDate cannot be before onsetDate' };

  if (has('frequency')) {
    if (body.frequency === null) out.frequency = null;
    else if (!FREQUENCIES.includes(body.frequency)) return { error: 'Unknown frequency' };
    else out.frequency = body.frequency;
  }

  if (has('associatedSymptoms')) {
    if (!Array.isArray(body.associatedSymptoms))
      return { error: 'associatedSymptoms must be a list' };
    const keys = [...new Set(body.associatedSymptoms)].filter((k) => k !== symptomKey);
    if (keys.length > ASSOCIATED_MAX || !keys.every(isKey)) {
      return { error: `Up to ${ASSOCIATED_MAX} associated symptoms, as slugs` };
    }
    out.associatedSymptoms = keys;
  }

  if (has('note')) out.note = body.note === null ? '' : cleanText(body.note, NOTE_MAX);

  if (partial && Object.keys(out).length === 0) return { error: 'Nothing to update' };
  return { value: out };
};

/** What the app gets back: no userId, no internals. */
export const serializeSymptomRecord = (doc) => {
  const r = typeof doc?.toJSON === 'function' ? doc.toJSON() : doc;
  return {
    id: String(r._id),
    symptomKey: r.symptomKey,
    customName: r.customName || null,
    regionId: r.regionId,
    side: r.side,
    severity: r.severity,
    status: r.status,
    onsetDate: r.onsetDate,
    resolvedDate: r.resolvedDate || null,
    frequency: r.frequency || null,
    associatedSymptoms: r.associatedSymptoms ?? [],
    note: r.note || '',
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
};
