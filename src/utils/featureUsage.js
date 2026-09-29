// Pure helpers for the feature usage beacon and report (models/FeatureUsage.js,
// controllers/appConfigController.js). No I/O, so they can be unit tested.
import { FEATURE_KEYS } from '../constants/appCatalog.js';

export const MAX_USAGE_EVENTS = 50;
export const USAGE_RANGES = [7, 30, 90];
const KINDS = new Set(['open', 'tap']);
const LINK_ITEM = /^link:[a-z0-9]{6,24}$/;
const KNOWN_FEATURES = new Set(FEATURE_KEYS);

/** A built-in feature key or a link tile's `link:<id>`. */
export const isUsageItem = (v) =>
  KNOWN_FEATURES.has(v) || (typeof v === 'string' && LINK_ITEM.test(v));

/** UTC "YYYY-MM-DD". */
export const dayOf = (date) => date.toISOString().slice(0, 10);

/**
 * `{ events: [{ itemKey, kind: open | tap }] }` → per-item counts. Unknown
 * items and kinds are skipped (a beacon never fails the app), and at most
 * MAX_USAGE_EVENTS are read.
 */
export const tallyUsageEvents = (body) => {
  const tally = new Map();
  const events = Array.isArray(body?.events) ? body.events.slice(0, MAX_USAGE_EVENTS) : [];
  for (const e of events) {
    if (!isUsageItem(e?.itemKey) || !KINDS.has(e?.kind)) continue;
    const t = tally.get(e.itemKey) ?? { opens: 0, taps: 0 };
    if (e.kind === 'open') t.opens += 1;
    else t.taps += 1;
    tally.set(e.itemKey, t);
  }
  return tally;
};

/** The last `days` UTC days, oldest first, ending today. */
export const usageDays = (days, now = new Date()) => {
  const out = [];
  for (let i = days - 1; i >= 0; i -= 1) out.push(dayOf(new Date(now.getTime() - i * 86_400_000)));
  return out;
};

/**
 * Daily rows `{ itemKey, day, opens, taps }` and unique-device counts
 * `{ itemKey: n }` → `{ [itemKey]: { opens, taps, devices, daily: [{ opens, taps }] } }`,
 * with `daily` aligned to `days`.
 */
export const summarizeUsage = (rows, deviceCounts, days) => {
  const index = new Map(days.map((d, i) => [d, i]));
  const items = {};
  for (const r of rows) {
    const i = index.get(r.day);
    if (i === undefined) continue;
    const item = (items[r.itemKey] ??= {
      opens: 0,
      taps: 0,
      devices: 0,
      daily: days.map(() => ({ opens: 0, taps: 0 })),
    });
    item.opens += r.opens ?? 0;
    item.taps += r.taps ?? 0;
    item.daily[i].opens += r.opens ?? 0;
    item.daily[i].taps += r.taps ?? 0;
  }
  for (const [itemKey, n] of Object.entries(deviceCounts))
    if (items[itemKey]) items[itemKey].devices = n;
  return items;
};
