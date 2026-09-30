import AppConfig from '../models/AppConfig.js';
import AppBanner from '../models/AppBanner.js';
import AppConfigRevision from '../models/AppConfigRevision.js';
import LaunchInterest from '../models/LaunchInterest.js';
import LaunchStat from '../models/LaunchStat.js';
import FeatureUsage from '../models/FeatureUsage.js';
import FeatureUsageDevice from '../models/FeatureUsageDevice.js';
import User from '../models/User.js';
import PushBroadcast, { MAX_SELECTED_RECIPIENTS } from '../models/PushBroadcast.js';
import { countAudience, enqueueBroadcast } from '../utils/pushBroadcastWorker.js';
import { isFcmReady } from '../utils/fcm.js';
import logger from '../utils/logger.js';
import { CONFIG_KEY, ensureConfig, saveSection } from '../utils/appConfigStore.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { uploadBufferToS3 } from '../utils/s3.js';
import { assertAllowedUpload } from '../utils/fileValidation.js';
import {
  AUDIENCE_PLATFORMS,
  AUDIENCE_SEGMENTS,
  BANNER_ACTIONS,
  BANNER_LAYOUTS,
  BANNER_PLACEMENTS,
  CONFIG_SECTIONS,
  FEATURE_CATALOG,
  FEATURE_PLACEMENTS,
  FEATURE_SIZES,
  MAX_CUSTOM_TILES,
  SCREEN_TITLES,
  THEME_TOKENS,
  TILE_ACTIONS,
  TILE_COLOR_KEYS,
  TILE_ICONS,
} from '../constants/appCatalog.js';
import {
  DEFAULT_AUDIENCE,
  bannerStatus,
  mergeFeatures,
  mergeHomeSections,
  mergeScreenSections,
  mergeScreenTitles,
  mergeSettings,
  parseBannerInput,
  parseCustomTiles,
  parseFeatures,
  parseAllScreenSections,
  parseAllScreenTitles,
  parseHomeSections,
  parseScreenSections,
  parseScreenTitle,
  parseSettings,
  parseTheme,
  toPublicBanner,
  toPublicSection,
} from '../utils/appConfig.js';
import {
  acceptsNotify,
  effectiveState,
  isDeviceId,
  isItemKey,
  liveTeaserError,
  mergeLaunch,
  parseLaunch,
  resolveLaunch,
  testerKind,
} from '../utils/launch.js';
import {
  USAGE_RANGES,
  dayOf,
  summarizeUsage,
  tallyUsageEvents,
  usageDays,
} from '../utils/featureUsage.js';

const liveBannerFilter = (now) => ({
  active: true,
  $and: [
    { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
    { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
  ],
});

/** Banners are part of what the app caches, so a banner change bumps the global version. */
const touchVersion = async (req) => {
  await ensureConfig();
  await AppConfig.updateOne(
    { key: CONFIG_KEY },
    { $inc: { version: 1 }, $set: { updatedBy: req.userId } },
  );
};

const publicTile = (t) => ({
  id: t.id,
  title: t.title,
  description: t.description || null,
  icon: t.icon,
  colorKey: t.colorKey,
  placement: t.placement,
  size: t.size,
  order: t.order,
  enabled: t.enabled !== false,
  badge: t.badge || null,
  action: t.action,
  audience: { ...DEFAULT_AUDIENCE, ...(t.audience || {}) },
  launch: mergeLaunch(t.launch),
});

const withLaunch = (f) => ({ ...f, launch: mergeLaunch(f.launch) });

/** Every feature and link tile with its item key and full launch, for lookups. */
const launchItems = (config) => [
  ...mergeFeatures(config?.features).map((f) => ({
    itemKey: f.key,
    launch: mergeLaunch(f.launch),
  })),
  ...(config?.customTiles ?? []).map((t) => ({
    itemKey: `link:${t.id}`,
    launch: mergeLaunch(t.launch),
  })),
];

/* ------------------------------- Public (app) ------------------------------ */

/**
 * GET /api/app-config — everything the app needs to lay itself out: feature
 * tiles, admin link tiles, home sections, theme overrides, app settings
 * (maintenance / update) and live banners. Public (it's shown before login
 * too). `no-cache` makes clients revalidate every time (a cheap 304 via the
 * ETag when nothing changed) so a publish is visible on the next fetch;
 * the app keeps its own offline copy.
 */
export const getAppConfig = async (req, res, next) => {
  try {
    const now = new Date();
    const [config, banners] = await Promise.all([
      AppConfig.findOne({ key: CONFIG_KEY }).lean(),
      AppBanner.find(liveBannerFilter(now)).sort({ priority: -1, createdAt: -1 }).limit(50).lean(),
    ]);

    // Launch states are worked out per person (testers, rollout buckets,
    // Notify me), so the answer is private and varies by who's asking. A
    // build that doesn't send X-Nura-Launch can't show a locked tile, so it
    // only gets the items that are plainly open.
    const supportsLaunch = req.get('X-Nura-Launch') === '1';
    const deviceId = isDeviceId(req.get('X-Device-Id')) ? req.get('X-Device-Id') : null;
    const viewer = { userId: req.userId ? String(req.userId) : null, deviceId, onList: new Set() };
    const features = mergeFeatures(config?.features).map(withLaunch);
    const tiles = (config?.customTiles ?? []).map(publicTile);
    if (supportsLaunch && (viewer.userId || deviceId)) {
      const asking = [...features.map((f) => f.key), ...tiles.map((t) => `link:${t.id}`)];
      const who = [];
      if (viewer.userId) who.push({ user: viewer.userId });
      if (deviceId) who.push({ deviceId, user: { $exists: false } });
      const joined = await LaunchInterest.find({ itemKey: { $in: asking }, $or: who })
        .select('itemKey')
        .lean();
      viewer.onList = new Set(joined.map((j) => j.itemKey));
      if (viewer.userId && deviceId) claimDeviceInterests(viewer.userId, deviceId);
    }
    const forViewer = (item, itemKey) => {
      const { launch, ...rest } = item;
      const resolved = resolveLaunch(itemKey, launch, viewer, now);
      if (resolved.hidden) {
        return { ...rest, enabled: false, ...(supportsLaunch ? { launch: resolved.launch } : {}) };
      }
      if (!supportsLaunch) return { ...rest, enabled: rest.enabled && resolved.plainOpen };
      return { ...rest, launch: resolved.launch };
    };

    res.set('Cache-Control', 'private, no-cache');
    res.set('Vary', 'Authorization, X-Device-Id, X-Nura-Launch');
    return sendResponse(res, HTTP_STATUS.OK, 'App config fetched', {
      version: config?.version ?? 0,
      features: features.map(({ defaults: _d, icon: _i, route: _r, ...f }) => forViewer(f, f.key)),
      customTiles: tiles.map((t) => forViewer(t, `link:${t.id}`)),
      homeSections: mergeHomeSections(config?.homeSections).map(toPublicSection),
      screenSections: Object.fromEntries(
        Object.entries(mergeScreenSections(config?.screenSections)).map(([screen, list]) => [
          screen,
          list.map(toPublicSection),
        ]),
      ),
      screenTitles: Object.fromEntries(
        Object.entries(mergeScreenTitles(config?.screenTitles))
          .filter(([, t]) => t.title)
          .map(([screen, t]) => [screen, t.title]),
      ),
      theme: { light: config?.theme?.light ?? {}, dark: config?.theme?.dark ?? {} },
      settings: mergeSettings(config?.settings),
      banners: banners.map(toPublicBanner),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/app-config/banners/:id/click — the app's fire-and-forget tap beacon. */
export const trackBannerClick = async (req, res, next) => {
  try {
    if (isValidObjectId(req.params.id)) {
      await AppBanner.updateOne({ _id: req.params.id }, { $inc: { clickCount: 1 } });
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Recorded', {});
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/app-config/banners/impressions — body `{ ids: [...] }` (≤ 20):
 * banners the app just showed. The app sends each id once per session.
 */
export const trackBannerImpressions = async (req, res, next) => {
  try {
    const ids = Array.isArray(req.body?.ids)
      ? [...new Set(req.body.ids.map(String))].filter(isValidObjectId).slice(0, 20)
      : [];
    if (ids.length) {
      await AppBanner.updateMany({ _id: { $in: ids } }, { $inc: { impressionCount: 1 } });
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Recorded', {});
  } catch (error) {
    next(error);
  }
};

/**
 * Give a device's signed-out Notify me entries to the account now signed in
 * on it, so the "It's here" push (sent to accounts) can reach them. Fire and
 * forget: a failure only means that person hears about the launch in the app.
 */
const claimDeviceInterests = async (userId, deviceId) => {
  try {
    const orphans = await LaunchInterest.find({ deviceId, user: { $exists: false } })
      .select('_id')
      .lean();
    for (const { _id } of orphans) {
      try {
        await LaunchInterest.updateOne(
          { _id },
          { $set: { user: userId }, $unset: { deviceId: 1 } },
        );
      } catch (error) {
        // The account already signed up for this one: the device entry is a duplicate.
        if (error?.code === 11000) await LaunchInterest.deleteOne({ _id });
        else throw error;
      }
    }
  } catch (error) {
    logger.warn('launch_interest_claim_failed', {
      action: 'launch_interest_claim_failed',
      error: error.message,
    });
  }
};

/**
 * POST /api/app-config/launch/:itemKey/notify — "Notify me" on a Coming soon
 * tile. Signed in, the entry is the account's (taking over this device's
 * signed-out entry if there is one); signed out, it's the device's.
 */
export const notifyLaunch = async (req, res, next) => {
  try {
    const { itemKey } = req.params;
    if (!isItemKey(itemKey)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Unknown feature');
    const deviceId = isDeviceId(req.get('X-Device-Id')) ? req.get('X-Device-Id') : null;
    if (!req.userId && !deviceId) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Missing device id');
    }
    const config = await AppConfig.findOne({ key: CONFIG_KEY }).lean();
    const item = launchItems(config).find((i) => i.itemKey === itemKey);
    if (!item || !acceptsNotify(item.launch)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This feature isn’t taking sign-ups');
    }
    const platform = ['android', 'ios', 'web'].includes(req.body?.platform)
      ? req.body.platform
      : null;

    try {
      if (req.userId) {
        const mine = await LaunchInterest.exists({ itemKey, user: req.userId });
        const claimed =
          !mine &&
          deviceId &&
          (await LaunchInterest.findOneAndUpdate(
            { itemKey, deviceId, user: { $exists: false } },
            { $set: { user: req.userId }, $unset: { deviceId: 1 } },
          ));
        if (!mine && !claimed) {
          await LaunchInterest.create({ itemKey, user: req.userId, platform });
        }
      } else if (!(await LaunchInterest.exists({ itemKey, deviceId }))) {
        await LaunchInterest.create({ itemKey, deviceId, platform });
      }
    } catch (error) {
      if (error?.code !== 11000) throw error; // a double tap raced us: already on the list
    }
    return sendResponse(res, HTTP_STATUS.OK, 'You’re on the list', { onList: true });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/app-config/usage — the app's batched usage beacon: body
 * { events: [{ itemKey, kind: open | tap }] } (≤ 50), X-Device-Id for
 * unique devices. Fire and forget: bad events are skipped, never refused.
 */
export const trackUsage = async (req, res, next) => {
  try {
    const tally = tallyUsageEvents(req.body);
    if (tally.size) {
      const day = dayOf(new Date());
      await FeatureUsage.bulkWrite(
        [...tally].map(([itemKey, t]) => ({
          updateOne: {
            filter: { itemKey, day },
            update: { $inc: { opens: t.opens, taps: t.taps } },
            upsert: true,
          },
        })),
        { ordered: false },
      );
      const deviceId = isDeviceId(req.get('X-Device-Id')) ? req.get('X-Device-Id') : null;
      if (deviceId) {
        await FeatureUsageDevice.bulkWrite(
          [...tally.keys()].map((itemKey) => ({
            updateOne: {
              filter: { itemKey, day, deviceId },
              update: { $setOnInsert: { itemKey, day, deviceId, createdAt: new Date() } },
              upsert: true,
            },
          })),
          { ordered: false },
        ).catch((error) => {
          // Two batches from one device racing: the entry exists either way.
          if (error?.code !== 11000 && !error?.writeErrors) throw error;
        });
      }
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Recorded', {});
  } catch (error) {
    next(error);
  }
};

/** POST /api/app-config/launch/:itemKey/tap — the app's beacon for a tap on a locked tile. */
export const trackLockedTap = async (req, res, next) => {
  try {
    const { itemKey } = req.params;
    if (isItemKey(itemKey)) {
      await LaunchStat.updateOne({ itemKey }, { $inc: { lockedTaps: 1 } }, { upsert: true });
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Recorded', {});
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------- CMS ---------------------------------- */

const editableState = (config) => ({
  version: config?.version ?? 0,
  sectionVersions: {
    features: config?.sectionVersions?.features ?? 0,
    homeSections: config?.sectionVersions?.homeSections ?? 0,
    screenSections: config?.sectionVersions?.screenSections ?? 0,
    theme: config?.sectionVersions?.theme ?? 0,
    settings: config?.sectionVersions?.settings ?? 0,
  },
  updatedAt: config?.updatedAt ?? null,
  updatedBy: config?.updatedBy ?? null,
  features: mergeFeatures(config?.features).map(withLaunch),
  customTiles: (config?.customTiles ?? []).map(publicTile),
  homeSections: mergeHomeSections(config?.homeSections),
  screenSections: mergeScreenSections(config?.screenSections),
  screenTitles: mergeScreenTitles(config?.screenTitles),
  theme: { light: config?.theme?.light ?? {}, dark: config?.theme?.dark ?? {} },
  settings: mergeSettings(config?.settings),
});

const loadEditable = () =>
  AppConfig.findOne({ key: CONFIG_KEY }).populate('updatedBy', 'firstName lastName email').lean();

/**
 * GET /api/cms/config — the editable state plus the catalog the editors
 * need (placements, colours, icons, audiences, the app's default theme).
 */
export const getCmsConfig = async (req, res, next) => {
  try {
    const config = await loadEditable();
    return sendResponse(res, HTTP_STATUS.OK, 'CMS config fetched', {
      ...editableState(config),
      catalog: {
        featurePlacements: FEATURE_PLACEMENTS,
        featureSizes: FEATURE_SIZES,
        tileColorKeys: TILE_COLOR_KEYS,
        tileIcons: TILE_ICONS,
        tileActions: TILE_ACTIONS,
        maxCustomTiles: MAX_CUSTOM_TILES,
        themeTokens: THEME_TOKENS,
        bannerPlacements: BANNER_PLACEMENTS,
        bannerLayouts: BANNER_LAYOUTS,
        bannerActions: BANNER_ACTIONS,
        audienceSegments: AUDIENCE_SEGMENTS,
        audiencePlatforms: AUDIENCE_PLATFORMS,
      },
    });
  } catch (error) {
    next(error);
  }
};

const respondWithConfig = async (res, message) =>
  sendResponse(res, HTTP_STATUS.OK, message, editableState(await loadEditable()));

const publish = async (req, res, { section, set, audit, message, metadata }) => {
  const saved = await saveSection(section, set, req.userId, { expected: req.body?.version });
  if (saved.conflict) return sendError(res, HTTP_STATUS.CONFLICT, saved.conflict);
  recordAudit({
    req,
    action: audit,
    resourceType: 'app_config',
    resourceId: String(saved.config._id),
    metadata: { ...metadata, version: saved.config.version },
  });
  return respondWithConfig(res, message);
};

/**
 * Tester entries typed in the CMS (user ids, emails or phone numbers) →
 * `{ id, label }` per entry, or `{ error }` naming the first one with no
 * app user behind it.
 */
const resolveTesters = async (entries) => {
  const unique = [...new Set(entries)];
  if (!unique.length) return { byEntry: new Map() };
  const ids = unique.filter((e) => testerKind(e) === 'id');
  const emails = unique.filter((e) => testerKind(e) === 'email').map((e) => e.toLowerCase());
  const phones = unique.filter((e) => testerKind(e) === 'phone');
  const digits = (p) => p.replace(/[^0-9]/g, '');
  const or = [];
  if (ids.length) or.push({ _id: { $in: ids } });
  if (emails.length) or.push({ email: { $in: emails } });
  // Phones are stored as typed at sign-up ("+91 98765 43210"), so match the
  // last 10 digits with anything between them.
  for (const p of phones) {
    or.push({ phone: { $regex: `${digits(p).slice(-10).split('').join('[^0-9]*')}$` } });
  }
  const users = await User.find({ $or: or }).select('email phone firstName lastName').lean();

  const byEntry = new Map();
  for (const entry of unique) {
    const kind = testerKind(entry);
    const user = users.find((u) =>
      kind === 'id'
        ? String(u._id) === entry.toLowerCase()
        : kind === 'email'
          ? u.email === entry.toLowerCase()
          : u.phone && digits(u.phone).endsWith(digits(entry).slice(-10)),
    );
    if (!user) return { error: `No app user with the email or phone “${entry}”` };
    const name = [user.firstName, user.lastName].filter(Boolean).join(' ');
    byEntry.set(entry, { id: String(user._id), label: user.email || user.phone || name || entry });
  }
  return { byEntry };
};

/**
 * Validate each item's `launch` against what's saved (for `since` and
 * schedules) and resolve its testers. Mutates the parsed items.
 */
const applyLaunches = async (items, rawItems, savedByKey, keyOf) => {
  const parsed = [];
  for (let i = 0; i < items.length; i += 1) {
    const r = parseLaunch(rawItems[i]?.launch, savedByKey.get(keyOf(items[i])));
    if (r.error) return { error: `${r.error} (“${items[i].title || items[i].key}”)` };
    parsed.push(r);
  }
  const resolved = await resolveTesters(parsed.flatMap((r) => r.testers));
  if (resolved.error) return { error: resolved.error };
  parsed.forEach((r, i) => {
    const seen = new Set();
    const testers = r.testers
      .map((e) => resolved.byEntry.get(e))
      .filter((t) => !seen.has(t.id) && seen.add(t.id));
    items[i].launch = { ...r.launch, testers };
  });
  return {};
};

/**
 * PUT /api/cms/features — body: { features: [...], customTiles?: [...], version? }.
 * Built-in features and admin link tiles share each hub's `order`, so
 * they're saved together as one section.
 */
export const updateFeatures = async (req, res, next) => {
  try {
    const parsed = parseFeatures(req.body?.features);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const tiles = parseCustomTiles(req.body?.customTiles);
    if (tiles.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, tiles.error);

    const saved = await AppConfig.findOne({ key: CONFIG_KEY })
      .select('features customTiles')
      .lean();
    const savedLaunch = new Map([
      ...(saved?.features ?? []).map((f) => [f.key, f.launch]),
      ...(saved?.customTiles ?? []).map((t) => [`link:${t.id}`, t.launch]),
    ]);
    const featureLaunches = await applyLaunches(
      parsed.features,
      req.body.features,
      savedLaunch,
      (f) => f.key,
    );
    if (featureLaunches.error)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, featureLaunches.error);
    const tileLaunches = await applyLaunches(
      tiles.tiles,
      req.body.customTiles ?? [],
      savedLaunch,
      (t) => `link:${t.id}`,
    );
    if (tileLaunches.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, tileLaunches.error);
    const teaser = liveTeaserError(tiles.tiles);
    if (teaser) return sendError(res, HTTP_STATUS.BAD_REQUEST, teaser);

    const notLive = Object.fromEntries(
      [
        ...parsed.features.map((f) => [f.key, f.launch.state]),
        ...tiles.tiles.map((t) => [`link:${t.id}`, t.launch.state]),
      ].filter(([, state]) => state !== 'live'),
    );
    return await publish(req, res, {
      section: 'features',
      set: { features: parsed.features, customTiles: tiles.tiles },
      audit: AUDIT_ACTIONS.CMS_FEATURES_UPDATED,
      message: 'Features published',
      metadata: {
        hidden: parsed.features.filter((f) => !f.enabled).map((f) => f.key),
        linkTiles: tiles.tiles.length,
        launches: notLive,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/cms/home — body: { homeSections: [{ key, visible, order }], version? }. */
export const updateHomeSections = async (req, res, next) => {
  try {
    const parsed = parseHomeSections(req.body?.homeSections);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    return await publish(req, res, {
      section: 'homeSections',
      set: { homeSections: parsed.sections },
      audit: AUDIT_ACTIONS.CMS_HOME_UPDATED,
      message: 'Home layout published',
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/cms/screens/:screen — body: { sections: [{ key, visible, order,
 * text?, audience?, startAt?, endAt? }], title?, version? }. Saves one
 * screen's blocks (and a hub's title); `version` is the screenSections section's.
 */
export const updateScreenSections = async (req, res, next) => {
  try {
    const { screen } = req.params;
    const parsed = parseScreenSections(screen, req.body?.sections);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const title = parseScreenTitle(screen, req.body?.title);
    if (title.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, title.error);
    return await publish(req, res, {
      section: 'screenSections',
      set: {
        [`screenSections.${screen}`]: parsed.sections,
        ...(Object.hasOwn(SCREEN_TITLES, screen) && { [`screenTitles.${screen}`]: title.value }),
      },
      audit: AUDIT_ACTIONS.CMS_SCREEN_UPDATED,
      message: 'Screen layout published',
      metadata: { screen },
    });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/cms/theme — body: { theme: { light: {...}, dark: {...} }, version? }. */
export const updateTheme = async (req, res, next) => {
  try {
    const parsed = parseTheme(req.body?.theme);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    return await publish(req, res, {
      section: 'theme',
      set: { theme: parsed.theme },
      audit: AUDIT_ACTIONS.CMS_THEME_UPDATED,
      message: 'Theme published',
      metadata: {
        light: Object.keys(parsed.theme.light).length,
        dark: Object.keys(parsed.theme.dark).length,
      },
    });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/cms/settings — body: { settings: { maintenance, update }, version? }. */
export const updateSettings = async (req, res, next) => {
  try {
    const parsed = parseSettings(req.body?.settings);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    return await publish(req, res, {
      section: 'settings',
      set: { settings: parsed.settings },
      audit: AUDIT_ACTIONS.CMS_SETTINGS_UPDATED,
      message: 'App settings published',
      metadata: {
        maintenance: parsed.settings.maintenance.enabled,
        minVersion: parsed.settings.update.minVersion,
        latestVersion: parsed.settings.update.latestVersion,
      },
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------------------- History -------------------------------- */

/** GET /api/cms/revisions?section= — newest first, up to 50 per section. */
export const listRevisions = async (req, res, next) => {
  try {
    const filter = CONFIG_SECTIONS.includes(req.query.section)
      ? { section: req.query.section }
      : {};
    const revisions = await AppConfigRevision.find(filter)
      .sort({ createdAt: -1 })
      .limit(100)
      .populate('createdBy', 'firstName lastName email')
      .lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Revisions fetched', { revisions });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/cms/revisions/:id/restore — republish a past revision of its
 * section as the current state (itself recorded as a new revision).
 */
export const restoreRevision = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid revision id');
    }
    const revision = await AppConfigRevision.findById(req.params.id).lean();
    if (!revision) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Revision not found');

    // Re-validate: the catalog may have changed since it was saved, and an
    // old snapshot must not bring back a key or value that's no longer valid.
    const d = revision.data || {};
    let set;
    if (revision.section === 'features') {
      const known = (d.features || []).filter((f) => mergeFeatures().some((m) => m.key === f.key));
      const parsed = parseFeatures(known);
      const tiles = parseCustomTiles(d.customTiles || []);
      if (parsed.error || tiles.error) {
        return sendError(res, HTTP_STATUS.CONFLICT, parsed.error || tiles.error);
      }
      set = { features: parsed.features, customTiles: tiles.tiles };
    } else if (revision.section === 'homeSections') {
      const parsed = parseHomeSections(d.homeSections || []);
      if (parsed.error) return sendError(res, HTTP_STATUS.CONFLICT, parsed.error);
      set = { homeSections: parsed.sections };
    } else if (revision.section === 'screenSections') {
      const parsed = parseAllScreenSections(d.screenSections);
      if (parsed.error) return sendError(res, HTTP_STATUS.CONFLICT, parsed.error);
      set = {
        screenSections: parsed.screenSections,
        screenTitles: parseAllScreenTitles(d.screenTitles),
      };
    } else if (revision.section === 'theme') {
      const parsed = parseTheme(d.theme || {});
      if (parsed.error) return sendError(res, HTTP_STATUS.CONFLICT, parsed.error);
      set = { theme: parsed.theme };
    } else if (revision.section === 'settings') {
      const parsed = parseSettings(mergeSettings(d.settings));
      if (parsed.error) return sendError(res, HTTP_STATUS.CONFLICT, parsed.error);
      set = { settings: parsed.settings };
    } else {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Unknown section');
    }

    const saved = await saveSection(revision.section, set, req.userId, {
      note: `Restored the version from ${new Date(revision.createdAt).toISOString()}`,
      restoredFrom: revision._id,
    });
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_REVISION_RESTORED,
      resourceType: 'app_config',
      resourceId: String(saved.config._id),
      metadata: { section: revision.section, revisionId: String(revision._id) },
    });
    return respondWithConfig(res, 'Revision restored');
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------- Usage --------------------------------- */

/**
 * GET /api/cms/usage?days=7|30|90 — per item key over the last `days` UTC
 * days: { days: [...], items: { [itemKey]: { opens, taps, devices, daily } } }.
 * `devices` counts distinct app installs that opened or tapped it.
 */
export const getUsage = async (req, res, next) => {
  try {
    const range = USAGE_RANGES.includes(Number(req.query.days)) ? Number(req.query.days) : 30;
    const days = usageDays(range);
    const since = { $gte: days[0] };
    const [rows, devices] = await Promise.all([
      FeatureUsage.find({ day: since }).select('itemKey day opens taps -_id').lean(),
      FeatureUsageDevice.aggregate([
        { $match: { day: since } },
        { $group: { _id: { itemKey: '$itemKey', deviceId: '$deviceId' } } },
        { $group: { _id: '$_id.itemKey', n: { $sum: 1 } } },
      ]),
    ]);
    const deviceCounts = Object.fromEntries(devices.map((d) => [d._id, d.n]));
    return sendResponse(res, HTTP_STATUS.OK, 'Usage fetched', {
      days,
      items: summarizeUsage(rows, deviceCounts, days),
    });
  } catch (error) {
    next(error);
  }
};

/* -------------------------------- Launches -------------------------------- */

/**
 * GET /api/cms/launches — per item key: Notify me sign-ups (`waiting`), how
 * many of them have an account and haven't had the "It's here" push yet
 * (`toNotify`), how many are signed-out devices a push can't reach
 * (`deviceOnly`), when the push last went out, and locked taps.
 */
export const getLaunchStats = async (req, res, next) => {
  try {
    const [waiting, taps] = await Promise.all([
      LaunchInterest.aggregate([
        {
          $group: {
            _id: '$itemKey',
            waiting: { $sum: 1 },
            toNotify: {
              $sum: {
                $cond: [
                  { $and: [{ $gt: ['$user', null] }, { $not: [{ $gt: ['$notifiedAt', null] }] }] },
                  1,
                  0,
                ],
              },
            },
            deviceOnly: { $sum: { $cond: [{ $gt: ['$user', null] }, 0, 1] } },
            lastNotifiedAt: { $max: '$notifiedAt' },
          },
        },
      ]),
      LaunchStat.find().lean(),
    ]);
    const stats = {};
    const entry = (key) =>
      (stats[key] ??= {
        waiting: 0,
        toNotify: 0,
        deviceOnly: 0,
        lastNotifiedAt: null,
        lockedTaps: 0,
      });
    for (const { _id, ...w } of waiting) Object.assign(entry(_id), w);
    for (const t of taps) entry(t.itemKey).lockedTaps = t.lockedTaps;
    return sendResponse(res, HTTP_STATUS.OK, 'Launch stats fetched', { stats });
  } catch (error) {
    next(error);
  }
};

/** Where tapping the "It's here" push goes: the feature's screen, or the tile's in-app route. */
const announceRoute = (config, itemKey) => {
  if (itemKey.startsWith('link:')) {
    const tile = (config?.customTiles ?? []).find((t) => `link:${t.id}` === itemKey);
    return tile?.action?.type === 'route' ? tile.action.value : null;
  }
  return FEATURE_CATALOG.find((f) => f.key === itemKey)?.route ?? null;
};

/**
 * POST /api/cms/launches/:itemKey/announce — body { title, body }. Pushes
 * "It's here" to everyone on a launched item's waitlist who has an account
 * and hasn't been told yet, through the normal broadcast worker (so it
 * shows in the Admin Workspace push history and the app's inbox). Signed-out
 * devices can't get a push; they see the live tile in the app. Up to
 * MAX_SELECTED_RECIPIENTS per send; press again for the rest.
 */
export const announceLaunch = async (req, res, next) => {
  try {
    const { itemKey } = req.params;
    if (!isItemKey(itemKey)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Unknown feature');
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!title || !body)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Write a title and a message');
    if (title.length > 100 || body.length > 500) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'The title or message is too long');
    }
    if (!isFcmReady()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Push notifications are not configured',
      );
    }

    const config = await AppConfig.findOne({ key: CONFIG_KEY }).lean();
    const item = launchItems(config).find((i) => i.itemKey === itemKey);
    if (!item) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Unknown feature');
    if (effectiveState(item.launch) !== 'live') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Launch it to everyone before announcing it');
    }

    const pending = await LaunchInterest.find({
      itemKey,
      user: { $type: 'objectId' },
      notifiedAt: null,
    })
      .sort({ createdAt: 1 })
      .limit(MAX_SELECTED_RECIPIENTS)
      .select('_id user')
      .lean();
    if (!pending.length) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'Everyone on the list with an account has been told',
      );
    }
    const userIds = pending.map((p) => p.user);
    const counts = await countAudience('selected', userIds);
    const route = announceRoute(config, itemKey);

    const broadcast = await PushBroadcast.create({
      title,
      body,
      audience: 'selected',
      userIds,
      recipientPreview: [`Waitlist: ${itemKey}`],
      data: route ? { route } : undefined,
      saveToInbox: true,
      ...counts,
      createdBy: req.userId,
    });
    await LaunchInterest.updateMany(
      { _id: { $in: pending.map((p) => p._id) } },
      { $set: { notifiedAt: new Date() } },
    );
    enqueueBroadcast(broadcast._id, 'selected');

    const remaining = await LaunchInterest.countDocuments({
      itemKey,
      user: { $type: 'objectId' },
      notifiedAt: null,
    });
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_LAUNCH_ANNOUNCED,
      resourceType: 'push_broadcast',
      resourceId: String(broadcast._id),
      metadata: { itemKey, title, recipients: userIds.length, ...counts },
    });
    return sendResponse(res, HTTP_STATUS.ACCEPTED, 'Announcement queued', {
      broadcastId: String(broadcast._id),
      recipients: userIds.length,
      withPush: counts.totalWithToken,
      remaining,
    });
  } catch (error) {
    next(error);
  }
};

const WAITLIST_LIMIT = 5000;

/** GET /api/cms/launches/:itemKey/waitlist — who tapped Notify me, newest first (for a CSV). */
export const getWaitlist = async (req, res, next) => {
  try {
    const { itemKey } = req.params;
    if (!isItemKey(itemKey)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Unknown feature');
    const entries = await LaunchInterest.find({ itemKey })
      .sort({ createdAt: -1 })
      .limit(WAITLIST_LIMIT)
      .populate('user', 'firstName lastName email phone')
      .lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Waitlist fetched', {
      entries: entries.map((e) => ({
        createdAt: e.createdAt,
        platform: e.platform ?? null,
        user: e.user ?? null,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/* --------------------------------- Banners -------------------------------- */

const withStatus = (b, now = new Date()) => ({
  ...b,
  audience: { ...DEFAULT_AUDIENCE, ...(b.audience || {}) },
  impressionCount: b.impressionCount ?? 0,
  status: bannerStatus(b, now),
});

/** GET /api/cms/banners — every banner with its current status and stats. */
export const listBanners = async (req, res, next) => {
  try {
    const banners = await AppBanner.find()
      .sort({ placement: 1, priority: -1, createdAt: -1 })
      .populate('updatedBy', 'firstName lastName email')
      .lean();
    const now = new Date();
    return sendResponse(res, HTTP_STATUS.OK, 'Banners fetched', {
      banners: banners.map((b) => withStatus(b, now)),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/cms/banners */
export const createBanner = async (req, res, next) => {
  try {
    const parsed = parseBannerInput(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const banner = await AppBanner.create({
      ...parsed.banner,
      createdBy: req.userId,
      updatedBy: req.userId,
    });
    await touchVersion(req);
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_BANNER_CREATED,
      resourceType: 'app_banner',
      resourceId: String(banner._id),
      metadata: { title: banner.title, placement: banner.placement },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Banner created', {
      banner: withStatus(banner.toObject()),
    });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/cms/banners/:id — replaces the editable fields (stats are kept). */
export const updateBanner = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid banner id');
    }
    const parsed = parseBannerInput(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const banner = await AppBanner.findByIdAndUpdate(
      req.params.id,
      { $set: { ...parsed.banner, updatedBy: req.userId } },
      { new: true, runValidators: true },
    ).lean();
    if (!banner) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Banner not found');
    await touchVersion(req);
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_BANNER_UPDATED,
      resourceType: 'app_banner',
      resourceId: String(banner._id),
      metadata: { title: banner.title, placement: banner.placement, active: banner.active },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Banner saved', { banner: withStatus(banner) });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/cms/banners/:id */
export const deleteBanner = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid banner id');
    }
    const banner = await AppBanner.findByIdAndDelete(req.params.id).lean();
    if (!banner) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Banner not found');
    await touchVersion(req);
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_BANNER_DELETED,
      resourceType: 'app_banner',
      resourceId: String(banner._id),
      metadata: { title: banner.title, clicks: banner.clickCount },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Banner deleted', { id: String(banner._id) });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/cms/upload — banner image (multipart `file`). Stored under
 * `cms/banners/`, not the uploader's `users/<id>/` prefix, so removing a
 * staff account never deletes images the app is still showing.
 */
export const uploadCmsImage = async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'No file uploaded');
    try {
      assertAllowedUpload(req.file.buffer, ['image']);
    } catch (validationError) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, validationError.message);
    }
    const { url, key } = await uploadBufferToS3({
      buffer: req.file.buffer,
      mimeType: req.file.mimetype,
      originalName: req.file.originalname,
      folder: 'cms/banners',
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Image uploaded', { url, key });
  } catch (error) {
    next(error);
  }
};
