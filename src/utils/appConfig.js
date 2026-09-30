// Pure helpers for the App CMS (models/AppConfig.js, models/AppBanner.js,
// controllers/appConfigController.js). No I/O, so they can be unit tested.
import crypto from 'crypto';
import {
  AUDIENCE_PLATFORMS,
  AUDIENCE_SEGMENTS,
  BANNER_ACTIONS,
  BANNER_LAYOUTS,
  BANNER_PLACEMENTS,
  DEFAULT_SETTINGS,
  FEATURE_CATALOG,
  FEATURE_PLACEMENTS,
  FEATURE_SIZES,
  HOME_SECTIONS,
  MAX_CUSTOM_TILES,
  SCREEN_SECTIONS,
  SCREEN_TITLES,
  SCREEN_TITLE_MAX,
  THEME_TOKEN_KEYS,
  TILE_COLOR_KEYS,
  TILE_ICONS,
} from '../constants/appCatalog.js';
import { isValidNotificationRoute } from './notificationRoute.js';

const CATALOG_BY_KEY = new Map(FEATURE_CATALOG.map((f) => [f.key, f]));

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGBA =
  /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*(0|1|0?\.\d+|1\.0+))?\s*\)$/i;

/** #RGB, #RRGGBB, #RRGGBBAA, rgb(…) or rgba(…) — what React Native accepts safely. */
export const isColor = (value) => {
  if (typeof value !== 'string') return false;
  const v = value.trim();
  if (HEX.test(v)) return true;
  const m = RGBA.exec(v);
  return Boolean(m) && [m[1], m[2], m[3]].every((n) => Number(n) <= 255);
};

const optionalText = (value, max, label) => {
  if (value === undefined || value === null) return { value: null };
  if (typeof value !== 'string') return { error: `${label} must be text` };
  const v = value.trim();
  if (v.length > max) return { error: `${label} must be at most ${max} characters` };
  return { value: v || null };
};

const isHttpsUrl = (v) => {
  try {
    return new URL(v).protocol === 'https:';
  } catch {
    return false;
  }
};

/* ------------------------------ Versions ------------------------------ */

const VERSION = /^\d{1,4}(\.\d{1,4}){0,2}$/;
export const isVersion = (v) => typeof v === 'string' && VERSION.test(v.trim());

/** -1 / 0 / 1, comparing "1.2" as "1.2.0". */
export const compareVersions = (a, b) => {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d > 0 ? 1 : -1;
  }
  return 0;
};

/* ------------------------------ Tap actions ------------------------------ */

// Schemes an "open another app" link may never use: they run code or read
// files instead of opening an app.
const BLOCKED_SCHEMES = new Set(['javascript', 'data', 'file', 'vbscript', 'blob', 'about']);
const APP_LINK = /^([a-z][a-z0-9+.-]{1,31}):\/{0,2}\S+$/i;

/** Another app's link, e.g. whatsapp://send?phone=…, youtube://…, or https:// (universal link). */
export const isAppLink = (v) => {
  if (typeof v !== 'string') return false;
  const m = APP_LINK.exec(v.trim());
  return Boolean(m) && !BLOCKED_SCHEMES.has(m[1].toLowerCase()) && v.length <= 1000;
};

/**
 * `{ type, value, fallbackUrl }` → validated action or `{ error }`.
 * route: in-app path; url: https website (in-app browser); app: another
 * app's link plus an optional https fallback (usually its store page).
 */
export const parseAction = (raw, allowed) => {
  const type = raw?.type ?? 'none';
  if (!allowed.includes(type)) return { error: 'Invalid tap action' };
  const value = typeof raw?.value === 'string' ? raw.value.trim() : '';
  if (type === 'none') return { action: { type, value: null, fallbackUrl: null } };
  if (type === 'route' && !isValidNotificationRoute(value)) {
    return { error: 'The in-app screen must be a path like /tracker' };
  }
  if (type === 'url' && !isHttpsUrl(value))
    return { error: 'The link must be a full https:// URL' };
  if (type === 'app' && !isAppLink(value)) {
    return { error: 'The app link must look like whatsapp://send?phone=… or https://…' };
  }
  let fallbackUrl = null;
  if (type === 'app' && raw?.fallbackUrl) {
    fallbackUrl = String(raw.fallbackUrl).trim();
    if (!isHttpsUrl(fallbackUrl)) return { error: 'The fallback link must be a full https:// URL' };
  }
  return { action: { type, value, fallbackUrl } };
};

/* -------------------------------- Audience -------------------------------- */

export const DEFAULT_AUDIENCE = {
  segment: 'all',
  platforms: [],
  minAppVersion: null,
  maxAppVersion: null,
};

/** Who sees an item; missing = everyone. */
export const parseAudience = (raw) => {
  if (raw === undefined || raw === null) return { audience: { ...DEFAULT_AUDIENCE } };
  if (typeof raw !== 'object') return { error: 'audience must be an object' };
  const segment = raw.segment ?? 'all';
  if (!AUDIENCE_SEGMENTS.includes(segment)) return { error: 'Invalid audience' };
  const platforms = Array.isArray(raw.platforms) ? [...new Set(raw.platforms)] : [];
  if (!platforms.every((p) => AUDIENCE_PLATFORMS.includes(p))) return { error: 'Invalid platform' };
  const versions = {};
  for (const field of ['minAppVersion', 'maxAppVersion']) {
    const v = raw[field];
    if (v === undefined || v === null || v === '') versions[field] = null;
    else if (!isVersion(v)) return { error: 'App versions look like 1.4.0' };
    else versions[field] = v.trim();
  }
  if (
    versions.minAppVersion &&
    versions.maxAppVersion &&
    compareVersions(versions.minAppVersion, versions.maxAppVersion) > 0
  ) {
    return { error: 'The minimum app version is above the maximum' };
  }
  // Every platform ticked is the same as none ticked.
  return {
    audience: {
      segment,
      platforms: platforms.length === AUDIENCE_PLATFORMS.length ? [] : platforms,
      ...versions,
    },
  };
};

/* -------------------------------- Features -------------------------------- */

/**
 * Validate the full feature list from the CMS. Every entry needs a known
 * `key`; text overrides are optional (null = use the app's default text).
 */
export const parseFeatures = (value) => {
  if (!Array.isArray(value)) return { error: 'features must be a list' };
  const seen = new Set();
  const features = [];
  for (const raw of value) {
    const key = raw?.key;
    if (!CATALOG_BY_KEY.has(key)) return { error: `Unknown feature "${key}"` };
    if (seen.has(key)) return { error: `Feature "${key}" is listed twice` };
    seen.add(key);

    if (!FEATURE_PLACEMENTS.includes(raw.placement)) {
      return { error: `Invalid placement for "${key}"` };
    }
    const size = raw.size ?? CATALOG_BY_KEY.get(key).size;
    if (!FEATURE_SIZES.includes(size)) return { error: `Invalid size for "${key}"` };
    const colorKey = raw.colorKey ?? CATALOG_BY_KEY.get(key).colorKey;
    if (!TILE_COLOR_KEYS.includes(colorKey)) return { error: `Invalid colour for "${key}"` };
    const order = Number(raw.order);
    if (!Number.isInteger(order) || order < 0 || order > 999) {
      return { error: `Invalid order for "${key}"` };
    }

    const title = optionalText(raw.title, 40, 'Title');
    const description = optionalText(raw.description, 80, 'Description');
    const badge = optionalText(raw.badge, 12, 'Badge');
    for (const r of [title, description, badge]) if (r.error) return { error: r.error };
    const audience = parseAudience(raw.audience);
    if (audience.error) return { error: `${audience.error} ("${key}")` };

    features.push({
      key,
      enabled: raw.enabled !== false,
      placement: raw.placement,
      size,
      colorKey,
      order,
      title: title.value,
      description: description.value,
      badge: badge.value,
      audience: audience.audience,
    });
  }
  return { features };
};

/**
 * Catalog defaults with saved overrides applied, one entry per catalog key
 * (a saved key no longer in the catalog is dropped). Sorted by placement
 * then order. `defaults` carries the app's own text so the CMS can show it
 * as a placeholder.
 */
export const mergeFeatures = (saved = []) => {
  const savedByKey = new Map(saved.map((f) => [f.key, f]));
  return FEATURE_CATALOG.map((d) => {
    const s = savedByKey.get(d.key) || {};
    return {
      key: d.key,
      icon: d.icon,
      route: d.route,
      enabled: s.enabled ?? true,
      placement: FEATURE_PLACEMENTS.includes(s.placement) ? s.placement : d.placement,
      size: FEATURE_SIZES.includes(s.size) ? s.size : d.size,
      colorKey: TILE_COLOR_KEYS.includes(s.colorKey) ? s.colorKey : d.colorKey,
      order: Number.isInteger(s.order) ? s.order : d.order,
      title: s.title || d.title,
      description: s.description || d.description,
      badge: s.badge || null,
      audience: { ...DEFAULT_AUDIENCE, ...(s.audience || {}) },
      // Raw; utils/launch.js mergeLaunch() fills it in (it imports this file).
      launch: s.launch ?? null,
      defaults: {
        title: d.title,
        description: d.description,
        placement: d.placement,
        size: d.size,
        colorKey: d.colorKey,
      },
    };
  }).sort(
    (a, b) =>
      FEATURE_PLACEMENTS.indexOf(a.placement) - FEATURE_PLACEMENTS.indexOf(b.placement) ||
      a.order - b.order,
  );
};

/* ------------------------------ Custom tiles ------------------------------ */

const TILE_ID = /^[a-z0-9]{6,24}$/;
export const newTileId = () => crypto.randomBytes(6).toString('hex');

/**
 * Admin-made link tiles that sit in a hub next to the built-in features
 * (same `order` space) and open a website, another app or an in-app screen.
 */
export const parseCustomTiles = (value) => {
  if (value === undefined || value === null) return { tiles: [] };
  if (!Array.isArray(value)) return { error: 'customTiles must be a list' };
  if (value.length > MAX_CUSTOM_TILES) {
    return { error: `At most ${MAX_CUSTOM_TILES} link tiles` };
  }
  const seen = new Set();
  const tiles = [];
  for (const raw of value) {
    const id = TILE_ID.test(raw?.id ?? '') ? raw.id : newTileId();
    if (seen.has(id)) return { error: 'Two link tiles share an id' };
    seen.add(id);

    const title = optionalText(raw?.title, 40, 'Title');
    if (title.error) return { error: title.error };
    if (!title.value) return { error: 'Every link tile needs a title' };
    const description = optionalText(raw.description, 80, 'Description');
    const badge = optionalText(raw.badge, 12, 'Badge');
    for (const r of [description, badge]) if (r.error) return { error: r.error };
    if (!TILE_ICONS.includes(raw.icon)) return { error: `Pick an icon for "${title.value}"` };
    if (!TILE_COLOR_KEYS.includes(raw.colorKey))
      return { error: `Invalid colour for "${title.value}"` };
    if (!FEATURE_PLACEMENTS.includes(raw.placement))
      return { error: `Invalid hub for "${title.value}"` };
    if (!FEATURE_SIZES.includes(raw.size)) return { error: `Invalid size for "${title.value}"` };
    const order = Number(raw.order);
    if (!Number.isInteger(order) || order < 0 || order > 999) {
      return { error: `Invalid order for "${title.value}"` };
    }
    // "none" is only for Coming soon teasers; the controller refuses it
    // on a tile that can open for anyone (it knows the launch state).
    const action = parseAction(raw.action ?? { type: 'none' }, BANNER_ACTIONS);
    if (action.error) return { error: `${action.error} ("${title.value}")` };
    const audience = parseAudience(raw.audience);
    if (audience.error) return { error: `${audience.error} ("${title.value}")` };

    tiles.push({
      id,
      title: title.value,
      description: description.value,
      icon: raw.icon,
      colorKey: raw.colorKey,
      placement: raw.placement,
      size: raw.size,
      order,
      enabled: raw.enabled !== false,
      badge: badge.value,
      action: action.action,
      audience: audience.audience,
    });
  }
  return { tiles };
};

/* --------------------------- Home & screen sections --------------------------- */

/** An optional ISO date: `{ value: Date | null }` or `{ error }`. */
const optionalDate = (v, label) => {
  if (v === undefined || v === null || v === '') return { value: null };
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? { error: `Invalid ${label} date` } : { value: d };
};

const isEveryone = (a) =>
  a.segment === 'all' && a.platforms.length === 0 && !a.minAppVersion && !a.maxAppVersion;

/**
 * `[{ key, visible, order, text?, audience?, startAt?, endAt? }]` checked
 * against one screen's `catalog` of blocks. `text` only on blocks that
 * declare it (null = the app's default); `audience` and the show-between
 * dates narrow who sees a block and when, so required blocks can't have them.
 */
const parseSectionList = (value, catalog, what) => {
  if (!Array.isArray(value)) return { error: `${what} sections must be a list` };
  const byKey = new Map(catalog.map((s) => [s.key, s]));
  const seen = new Set();
  const sections = [];
  for (const raw of value) {
    const known = byKey.get(raw?.key);
    if (!known) return { error: `Unknown ${what} section "${raw?.key}"` };
    if (seen.has(raw.key)) return { error: `${what} section "${raw.key}" is listed twice` };
    seen.add(raw.key);
    const order = Number(raw.order);
    if (!Number.isInteger(order) || order < 0 || order > 99) {
      return { error: `Invalid order for "${raw.key}"` };
    }
    if (known.required && raw.visible === false) {
      return { error: `"${known.label}" can be moved but not hidden` };
    }

    let text = { value: null };
    if (raw.text !== undefined && raw.text !== null && raw.text !== '') {
      if (!known.text) return { error: `"${known.label}" has no text to change` };
      text = optionalText(raw.text, known.text.max, `${known.label} text`);
      if (text.error) return text;
      // The app's own text is saved as "no override", so a later change to
      // the default in the app still reaches this block.
      if (text.value === known.text.default) text.value = null;
    }

    const audience = parseAudience(raw.audience);
    if (audience.error) return { error: `${known.label}: ${audience.error}` };
    const startAt = optionalDate(raw.startAt, `${known.label} start`);
    const endAt = optionalDate(raw.endAt, `${known.label} end`);
    if (startAt.error || endAt.error) return startAt.error ? startAt : endAt;
    if (startAt.value && endAt.value && endAt.value <= startAt.value) {
      return { error: `${known.label}: the end must be after the start` };
    }
    const narrowed = !isEveryone(audience.audience) || startAt.value || endAt.value;
    if (known.required && narrowed) {
      return { error: `"${known.label}" is always shown, so it can't be targeted or scheduled` };
    }

    sections.push({
      key: raw.key,
      visible: raw.visible !== false,
      order,
      text: text.value,
      audience: audience.audience,
      startAt: startAt.value,
      endAt: endAt.value,
    });
  }
  return { sections };
};

/**
 * Every block in `catalog`, saved settings applied, sorted for display.
 * `text` is the override (null = default); the catalog's `textLabel`,
 * `textDefault` and `textMax` tell the CMS what can be edited.
 */
const mergeSectionList = (catalog, saved = []) => {
  const savedByKey = new Map((Array.isArray(saved) ? saved : []).map((s) => [s?.key, s]));
  return catalog
    .map((d) => {
      const s = savedByKey.get(d.key) || {};
      return {
        key: d.key,
        label: d.label,
        ...('required' in d && { required: d.required }),
        ...(d.text && {
          textLabel: d.text.label,
          textDefault: d.text.default,
          textMax: d.text.max,
        }),
        visible: d.required ? true : (s.visible ?? true),
        order: Number.isInteger(s.order) ? s.order : d.order,
        text: d.text && typeof s.text === 'string' && s.text ? s.text : null,
        audience: d.required
          ? { ...DEFAULT_AUDIENCE }
          : { ...DEFAULT_AUDIENCE, ...(s.audience ?? {}) },
        startAt: (!d.required && s.startAt) || null,
        endAt: (!d.required && s.endAt) || null,
      };
    })
    .sort((a, b) => a.order - b.order);
};

/** What the app gets for a merged block: no CMS labels. */
export const toPublicSection = ({ key, visible, order, text, audience, startAt, endAt }) => ({
  key,
  visible,
  order,
  text,
  audience,
  startAt,
  endAt,
});

export const parseHomeSections = (value) => parseSectionList(value, HOME_SECTIONS, 'Home');

export const mergeHomeSections = (saved = []) => mergeSectionList(HOME_SECTIONS, saved);

/** One screen's blocks, e.g. ('profile', [{ key, visible, order }]). */
export const parseScreenSections = (screen, value) => {
  if (!Object.hasOwn(SCREEN_SECTIONS, screen)) return { error: `Unknown screen "${screen}"` };
  return parseSectionList(value, SCREEN_SECTIONS[screen], screen);
};

/** Every screen's blocks: `{ profile: [...], care_hub: [...], ... }`. */
export const mergeScreenSections = (saved = {}) =>
  Object.fromEntries(
    Object.entries(SCREEN_SECTIONS).map(([screen, catalog]) => [
      screen,
      mergeSectionList(catalog, saved?.[screen]),
    ]),
  );

/** A hub's title override: `{ value: string | null }` or `{ error }`. */
export const parseScreenTitle = (screen, value) => {
  if (value === undefined || value === null || value === '') return { value: null };
  if (!Object.hasOwn(SCREEN_TITLES, screen)) return { error: 'This screen has no title to change' };
  const t = optionalText(value, SCREEN_TITLE_MAX, 'Title');
  if (t.error) return t;
  return { value: t.value === SCREEN_TITLES[screen] ? null : t.value };
};

/** `{ care_hub: { title, default } … }` for every screen with a title. */
export const mergeScreenTitles = (saved = {}) =>
  Object.fromEntries(
    Object.entries(SCREEN_TITLES).map(([screen, dflt]) => [
      screen,
      {
        title: typeof saved?.[screen] === 'string' && saved[screen] ? saved[screen] : null,
        default: dflt,
      },
    ]),
  );

/** Saved hub titles re-validated (a restored snapshot); bad ones are dropped. */
export const parseAllScreenTitles = (value) => {
  const out = {};
  for (const [screen, title] of Object.entries(value && typeof value === 'object' ? value : {})) {
    const t = parseScreenTitle(screen, title);
    if (!t.error && t.value) out[screen] = t.value;
  }
  return out;
};

/**
 * A whole `screenSections` snapshot (from a revision) re-validated screen
 * by screen; screens or blocks the catalog no longer has are dropped.
 */
export const parseAllScreenSections = (value) => {
  const out = {};
  for (const [screen, list] of Object.entries(value && typeof value === 'object' ? value : {})) {
    if (!Object.hasOwn(SCREEN_SECTIONS, screen) || !Array.isArray(list)) continue;
    const keys = new Set(SCREEN_SECTIONS[screen].map((s) => s.key));
    const parsed = parseScreenSections(
      screen,
      list.filter((s) => keys.has(s?.key)),
    );
    if (parsed.error) return parsed;
    out[screen] = parsed.sections;
  }
  return { screenSections: out };
};

/* ---------------------------------- Theme ---------------------------------- */

/**
 * `{ light: { token: color }, dark: { … } }` → only known tokens with valid
 * colours. An empty value means "back to the app default" and is dropped.
 */
export const parseTheme = (value) => {
  if (!value || typeof value !== 'object') return { error: 'theme must be an object' };
  const theme = { light: {}, dark: {} };
  for (const mode of ['light', 'dark']) {
    const colors = value[mode] ?? {};
    if (typeof colors !== 'object' || Array.isArray(colors)) {
      return { error: `theme.${mode} must be an object` };
    }
    for (const [token, color] of Object.entries(colors)) {
      if (!THEME_TOKEN_KEYS.includes(token)) return { error: `Unknown theme colour "${token}"` };
      if (color === null || color === '') continue;
      if (!isColor(color))
        return { error: `"${color}" is not a valid colour for ${mode} ${token}` };
      theme[mode][token] = color.trim();
    }
  }
  return { theme };
};

/* -------------------------------- Settings -------------------------------- */

/** Saved settings over the defaults (so a new field always has a value). */
export const mergeSettings = (saved = {}) => ({
  maintenance: { ...DEFAULT_SETTINGS.maintenance, ...(saved?.maintenance || {}) },
  update: { ...DEFAULT_SETTINGS.update, ...(saved?.update || {}) },
});

export const parseSettings = (value) => {
  if (!value || typeof value !== 'object') return { error: 'settings must be an object' };
  const m = value.maintenance ?? {};
  const u = value.update ?? {};

  const mTitle = optionalText(m.title, 60, 'Maintenance title');
  const mMessage = optionalText(m.message, 300, 'Maintenance message');
  const uTitle = optionalText(u.title, 60, 'Update title');
  const uMessage = optionalText(u.message, 300, 'Update message');
  for (const r of [mTitle, mMessage, uTitle, uMessage]) if (r.error) return { error: r.error };
  if (m.enabled === true && !mMessage.value) return { error: 'Add a maintenance message' };

  const versions = {};
  for (const field of ['minVersion', 'latestVersion']) {
    const v = u[field];
    if (v === undefined || v === null || v === '') versions[field] = null;
    else if (!isVersion(v)) return { error: 'App versions look like 1.4.0' };
    else versions[field] = v.trim();
  }
  if (
    versions.minVersion &&
    versions.latestVersion &&
    compareVersions(versions.minVersion, versions.latestVersion) > 0
  ) {
    return { error: 'The minimum version can’t be above the latest version' };
  }
  const links = {};
  for (const field of ['androidUrl', 'iosUrl']) {
    const v = u[field];
    if (v === undefined || v === null || v === '') links[field] = null;
    else if (!isHttpsUrl(v)) return { error: 'Store links must be full https:// URLs' };
    else links[field] = String(v).trim();
  }
  if ((versions.minVersion || versions.latestVersion) && !links.androidUrl && !links.iosUrl) {
    return { error: 'Add at least one store link so people can update' };
  }

  return {
    settings: {
      maintenance: {
        enabled: m.enabled === true,
        title: mTitle.value || DEFAULT_SETTINGS.maintenance.title,
        message: mMessage.value || DEFAULT_SETTINGS.maintenance.message,
      },
      update: {
        ...versions,
        title: uTitle.value || DEFAULT_SETTINGS.update.title,
        message: uMessage.value || DEFAULT_SETTINGS.update.message,
        ...links,
      },
    },
  };
};

/* --------------------------------- Banners --------------------------------- */

/**
 * Validate a banner create/update body into stored fields, or `{ error }`.
 */
export const parseBannerInput = (body = {}) => {
  const title = optionalText(body.title, 60, 'Title');
  if (title.error) return { error: title.error };
  if (!title.value) return { error: 'Title is required' };
  const subtitle = optionalText(body.subtitle, 140, 'Subtitle');
  const ctaLabel = optionalText(body.ctaLabel, 24, 'Button label');
  for (const r of [subtitle, ctaLabel]) if (r.error) return { error: r.error };

  const imageUrl = optionalText(body.imageUrl, 1000, 'Image URL');
  if (imageUrl.error) return { error: imageUrl.error };
  if (imageUrl.value && !isHttpsUrl(imageUrl.value)) return { error: 'Image URL must be https' };

  if (!BANNER_PLACEMENTS.includes(body.placement)) return { error: 'Pick where the banner shows' };
  const layout = body.layout ?? 'card';
  if (!BANNER_LAYOUTS.includes(layout)) return { error: 'Invalid layout' };
  if (layout === 'image' && !imageUrl.value) return { error: 'An image banner needs an image' };

  const action = parseAction(body.action, BANNER_ACTIONS);
  if (action.error) return { error: action.error };
  const audience = parseAudience(body.audience);
  if (audience.error) return { error: audience.error };

  for (const field of ['backgroundColor', 'textColor']) {
    const v = body[field];
    if (v !== undefined && v !== null && v !== '' && !isColor(v)) {
      return { error: `${field === 'textColor' ? 'Text' : 'Background'} colour is not valid` };
    }
  }

  const priority = body.priority === undefined ? 0 : Number(body.priority);
  if (!Number.isInteger(priority) || priority < 0 || priority > 100) {
    return { error: 'Priority must be a whole number from 0 to 100' };
  }

  const dates = {};
  for (const field of ['startAt', 'endAt']) {
    const v = body[field];
    if (v === undefined || v === null || v === '') {
      dates[field] = null;
      continue;
    }
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) {
      return { error: `Invalid ${field === 'startAt' ? 'start' : 'end'} date` };
    }
    dates[field] = d;
  }
  if (dates.startAt && dates.endAt && dates.endAt <= dates.startAt) {
    return { error: 'The end must be after the start' };
  }

  return {
    banner: {
      title: title.value,
      subtitle: subtitle.value,
      ctaLabel: ctaLabel.value,
      imageUrl: imageUrl.value,
      placement: body.placement,
      layout,
      action: action.action,
      audience: audience.audience,
      backgroundColor: body.backgroundColor ? String(body.backgroundColor).trim() : null,
      textColor: body.textColor ? String(body.textColor).trim() : null,
      priority,
      active: body.active !== false,
      dismissible: body.dismissible === true,
      ...dates,
    },
  };
};

/** 'inactive' | 'scheduled' | 'live' | 'expired' at `now`. */
export const bannerStatus = (banner, now = new Date()) => {
  if (!banner.active) return 'inactive';
  if (banner.startAt && new Date(banner.startAt) > now) return 'scheduled';
  if (banner.endAt && new Date(banner.endAt) <= now) return 'expired';
  return 'live';
};

/** What the app receives for one banner. */
export const toPublicBanner = (b) => ({
  id: String(b._id),
  title: b.title,
  subtitle: b.subtitle || null,
  ctaLabel: b.ctaLabel || null,
  imageUrl: b.imageUrl || null,
  placement: b.placement,
  layout: b.layout,
  action: {
    type: b.action?.type || 'none',
    value: b.action?.value || null,
    fallbackUrl: b.action?.fallbackUrl || null,
  },
  audience: { ...DEFAULT_AUDIENCE, ...(b.audience || {}) },
  backgroundColor: b.backgroundColor || null,
  textColor: b.textColor || null,
  priority: b.priority,
  dismissible: Boolean(b.dismissible),
  endAt: b.endAt || null,
});
