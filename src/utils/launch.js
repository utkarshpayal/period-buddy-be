// Launch states for App CMS features and link tiles: Coming soon, Rolling
// out, Live, Paused (The-Nura-CMS docs/launch-states.md §7). Pure helpers, no
// I/O, so they can be unit tested; tester lookup and the schedule runner
// live in controllers/appConfigController.js and utils/launchScheduleRunner.js.
import crypto from 'crypto';
import { BANNER_ACTIONS } from '../constants/appCatalog.js';
import { DEFAULT_AUDIENCE, parseAction, parseAudience } from './appConfig.js';

export const LAUNCH_STATES = ['live', 'coming_soon', 'rolling_out', 'paused'];
export const LAUNCH_HEADLINES = ['soon', 'this_month', 'next_month', 'custom'];
export const MAX_TESTERS = 50;

const NO_ACTION = { type: 'none', value: null, fallbackUrl: null };

export const DEFAULT_LAUNCH = Object.freeze({
  state: 'live',
  resumeTo: 'live',
  rollout: { percent: 10, audience: DEFAULT_AUDIENCE, othersSee: 'coming_soon', betaLabel: false },
  soon: { headline: 'soon', customHeadline: null, message: null, notifyMe: true, goLiveAt: null },
  paused: {
    title: null,
    message: null,
    alternative: NO_ACTION,
    alternativeLabel: null,
    resumeAt: null,
  },
  testers: [],
  since: null,
});

const HEADLINE_TEXT = {
  soon: 'Coming soon',
  this_month: 'Coming this month',
  next_month: 'Coming next month',
};
export const PAUSED_TITLE = 'Taking a short break';
export const PAUSED_MESSAGE = 'We’re working on it. Please check back soon.';

const OBJECT_ID = /^[a-f0-9]{24}$/i;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9][0-9 ()-]{6,19}$/;
const DEVICE_ID = /^[A-Za-z0-9-]{8,64}$/;
const TILE_ITEM = /^link:[a-z0-9]{6,24}$/;
const FEATURE_ITEM = /^[A-Za-z][A-Za-z0-9]{0,39}$/;

export const isDeviceId = (v) => typeof v === 'string' && DEVICE_ID.test(v);
/** A feature key or `link:<tileId>` — the shape, not whether it exists. */
export const isItemKey = (v) =>
  typeof v === 'string' && (TILE_ITEM.test(v) || FEATURE_ITEM.test(v));

/** What a tester entry typed in the CMS is: a user id, an email or a phone number. */
export const testerKind = (v) => {
  if (OBJECT_ID.test(v)) return 'id';
  if (EMAIL.test(v)) return 'email';
  if (PHONE.test(v)) return 'phone';
  return null;
};

const toIso = (d) => (d ? new Date(d).toISOString() : null);

/** Saved launch (possibly partial, or none for items saved before launches) → every field. */
export const mergeLaunch = (saved) => {
  const s = saved && typeof saved === 'object' ? saved : {};
  const d = DEFAULT_LAUNCH;
  return {
    state: LAUNCH_STATES.includes(s.state) ? s.state : d.state,
    resumeTo: s.resumeTo === 'rolling_out' ? 'rolling_out' : 'live',
    rollout: {
      ...d.rollout,
      ...(s.rollout || {}),
      audience: { ...DEFAULT_AUDIENCE, ...(s.rollout?.audience || {}) },
    },
    soon: { ...d.soon, ...(s.soon || {}), goLiveAt: toIso(s.soon?.goLiveAt) },
    paused: {
      ...d.paused,
      ...(s.paused || {}),
      alternative: { ...NO_ACTION, ...(s.paused?.alternative || {}) },
      resumeAt: toIso(s.paused?.resumeAt),
    },
    testers: Array.isArray(s.testers)
      ? s.testers.map((t) => ({ id: String(t.id), label: t.label }))
      : [],
    since: toIso(s.since),
  };
};

const optionalText = (value, max, label) => {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const v = value.trim();
  if (v.length > max) return { error: `${label} must be at most ${max} characters` };
  return { value: v || null };
};

/**
 * A schedule date from the CMS. It must be in the future, unless it's the
 * date already saved (a publish of something else in the section mustn't
 * fail because a schedule is about to fire).
 */
const parseSchedule = (value, saved, now, label) => {
  if (value === undefined || value === null || value === '') return { value: null };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { error: `Invalid ${label} date` };
  if (d <= now && d.toISOString() !== saved)
    return { error: `The ${label} date must be in the future` };
  return { value: d.toISOString() };
};

/**
 * Validate one item's `launch` from the CMS. `testers` comes back as the
 * raw strings (ids, emails or phones); the controller resolves them to
 * users. `since` is set here: now when the state changed, else kept.
 */
export const parseLaunch = (raw, saved, now = new Date()) => {
  const prev = mergeLaunch(saved);
  if (raw === undefined || raw === null)
    return { launch: prev, testers: prev.testers.map((t) => t.id) };
  if (typeof raw !== 'object') return { error: 'launch must be an object' };

  const state = raw.state ?? 'live';
  if (!LAUNCH_STATES.includes(state)) return { error: 'Invalid launch state' };
  const resumeTo = raw.resumeTo === 'rolling_out' ? 'rolling_out' : 'live';

  const r = raw.rollout ?? {};
  const percent = r.percent === undefined ? DEFAULT_LAUNCH.rollout.percent : Number(r.percent);
  if (!Number.isInteger(percent) || percent < 0 || percent > 100) {
    return { error: 'The rollout must be a whole percentage from 0 to 100' };
  }
  const sliceAudience = parseAudience(r.audience);
  if (sliceAudience.error) return { error: `Rollout: ${sliceAudience.error}` };
  const othersSee = r.othersSee === 'hidden' ? 'hidden' : 'coming_soon';

  const s = raw.soon ?? {};
  const headline = s.headline ?? 'soon';
  if (!LAUNCH_HEADLINES.includes(headline)) return { error: 'Invalid Coming soon headline' };
  const customHeadline = optionalText(s.customHeadline, 40, 'The headline');
  const soonMessage = optionalText(s.message, 160, 'The Coming soon message');
  for (const t of [customHeadline, soonMessage]) if (t.error) return { error: t.error };
  if (headline === 'custom' && !customHeadline.value) return { error: 'Write the custom headline' };
  const goLiveAt =
    state === 'coming_soon' || state === 'rolling_out'
      ? parseSchedule(s.goLiveAt, prev.soon.goLiveAt, now, 'go-live')
      : { value: null };
  if (goLiveAt.error) return { error: goLiveAt.error };

  const p = raw.paused ?? {};
  const pausedTitle = optionalText(p.title, 60, 'The paused title');
  const pausedMessage = optionalText(p.message, 200, 'The paused message');
  const alternativeLabel = optionalText(p.alternativeLabel, 24, 'The button label');
  for (const t of [pausedTitle, pausedMessage, alternativeLabel])
    if (t.error) return { error: t.error };
  const alternative = parseAction(p.alternative, BANNER_ACTIONS);
  if (alternative.error) return { error: `Paused alternative: ${alternative.error}` };
  const resumeAt =
    state === 'paused'
      ? parseSchedule(p.resumeAt, prev.paused.resumeAt, now, 'resume')
      : { value: null };
  if (resumeAt.error) return { error: resumeAt.error };

  if (raw.testers !== undefined && !Array.isArray(raw.testers))
    return { error: 'testers must be a list' };
  const testers = [
    ...new Set((raw.testers ?? []).map((t) => String(t ?? '').trim()).filter(Boolean)),
  ];
  if (testers.length > MAX_TESTERS) return { error: `At most ${MAX_TESTERS} testers per item` };
  const bad = testers.find((t) => !testerKind(t));
  if (bad) return { error: `“${bad}” isn’t an email, phone number or user id` };

  return {
    launch: {
      state,
      resumeTo,
      rollout: {
        percent,
        audience: sliceAudience.audience,
        othersSee,
        betaLabel: r.betaLabel === true,
      },
      soon: {
        headline,
        customHeadline: customHeadline.value,
        message: soonMessage.value,
        notifyMe: s.notifyMe !== false,
        goLiveAt: goLiveAt.value,
      },
      paused: {
        title: pausedTitle.value,
        message: pausedMessage.value,
        alternative: alternative.action,
        alternativeLabel: alternative.action.type === 'none' ? null : alternativeLabel.value,
        resumeAt: resumeAt.value,
      },
      testers: [],
      since: state === prev.state ? prev.since : now.toISOString(),
    },
    testers,
  };
};

/**
 * The state right now: a go-live or resume time that has passed counts as
 * done, even before the schedule runner has published it.
 */
export const effectiveState = (launch, now = new Date()) => {
  const { state } = launch;
  if ((state === 'coming_soon' || state === 'rolling_out') && launch.soon.goLiveAt) {
    if (new Date(launch.soon.goLiveAt) <= now) return 'live';
  }
  if (state === 'paused' && launch.paused.resumeAt && new Date(launch.paused.resumeAt) <= now) {
    return launch.resumeTo;
  }
  return state;
};

/**
 * 0–99, stable per item and person. Raising a rollout from 10% to 25% only
 * adds people, and a different item gets a different 10%.
 */
export const rolloutBucket = (itemKey, id) =>
  parseInt(crypto.createHash('sha256').update(`${itemKey}:${id}`).digest('hex').slice(0, 8), 16) %
  100;

const isEveryone = (a) =>
  a.segment === 'all' && a.platforms.length === 0 && !a.minAppVersion && !a.maxAppVersion;

export const headlineText = (soon) =>
  soon.headline === 'custom'
    ? soon.customHeadline || HEADLINE_TEXT.soon
    : HEADLINE_TEXT[soon.headline];

/**
 * What the app gets for one item and one viewer (§7.3): `{ launch, plainOpen }`
 * where `plainOpen` means an app build without launch support can show it.
 * `hidden: true` means no tile at all; `launch` then still says "soon" (no
 * Notify me) so the app's route guard keeps stale links out of the screen.
 * `viewer` is `{ userId, deviceId, onList: Set<itemKey> }`.
 */
export const resolveLaunch = (itemKey, launch, viewer, now = new Date()) => {
  const state = effectiveState(launch, now);
  const tester =
    Boolean(viewer.userId) && launch.testers.some((t) => t.id === String(viewer.userId));
  let access;
  let beta = false;
  let openFor = null;
  let fallback = 'soon';
  let hidden = false;

  if (tester || state === 'live') access = 'open';
  else if (state === 'coming_soon') access = 'soon';
  else if (state === 'paused') access = 'paused';
  else {
    const { percent, audience, othersSee, betaLabel } = launch.rollout;
    const id = viewer.userId ? String(viewer.userId) : viewer.deviceId;
    const inSlice = percent >= 100 || (Boolean(id) && rolloutBucket(itemKey, id) < percent);
    fallback = othersSee === 'hidden' ? 'hidden' : 'soon';
    if (!inSlice) {
      hidden = fallback === 'hidden';
      access = 'soon';
    } else {
      access = 'open';
      beta = betaLabel;
      openFor = isEveryone(audience) ? null : audience;
    }
  }

  const paused = access === 'paused';
  return {
    ...(hidden ? { hidden } : {}),
    plainOpen: access === 'open' && !openFor,
    launch: {
      access,
      beta,
      openFor,
      fallback,
      sheet: {
        headline: paused ? launch.paused.title || PAUSED_TITLE : headlineText(launch.soon),
        message: paused ? launch.paused.message || PAUSED_MESSAGE : launch.soon.message,
        notifyMe: access === 'soon' && !hidden && launch.soon.notifyMe,
        onList: viewer.onList?.has(itemKey) ?? false,
        alternative: paused ? launch.paused.alternative : NO_ACTION,
        alternativeLabel: paused ? launch.paused.alternativeLabel : null,
      },
    },
  };
};

/** Whether "Notify me" is open for an item right now. */
export const acceptsNotify = (launch, now = new Date()) => {
  const state = effectiveState(launch, now);
  return (state === 'coming_soon' || state === 'rolling_out') && launch.soon.notifyMe;
};

/**
 * Apply every schedule that is due to saved features and link tiles.
 * Returns the updated lists and what changed (empty when nothing was due).
 */
export const applyDueSchedules = (features = [], customTiles = [], now = new Date()) => {
  const changes = [];
  const apply = (item, itemKey, name) => {
    if (!item.launch) return item;
    const launch = mergeLaunch(item.launch);
    const next = effectiveState(launch, now);
    if (next === launch.state) return item;
    changes.push({ itemKey, name, from: launch.state, to: next });
    return {
      ...item,
      launch: {
        ...launch,
        state: next,
        soon: { ...launch.soon, goLiveAt: null },
        paused: { ...launch.paused, resumeAt: null },
        since: now.toISOString(),
      },
    };
  };
  return {
    features: features.map((f) => apply(f, f.key, f.title || f.key)),
    customTiles: customTiles.map((t) => apply(t, `link:${t.id}`, t.title)),
    changes,
  };
};
