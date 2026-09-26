import AppConfig from '../models/AppConfig.js';
import AppBanner from '../models/AppBanner.js';
import AppConfigRevision, { REVISIONS_KEPT } from '../models/AppConfigRevision.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { uploadBufferToS3 } from '../utils/s3.js';
import { assertAllowedUpload } from '../utils/fileValidation.js';
import logger from '../utils/logger.js';
import {
  AUDIENCE_PLATFORMS,
  AUDIENCE_SEGMENTS,
  BANNER_ACTIONS,
  BANNER_LAYOUTS,
  BANNER_PLACEMENTS,
  CONFIG_SECTIONS,
  FEATURE_PLACEMENTS,
  FEATURE_SIZES,
  MAX_CUSTOM_TILES,
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
  mergeSettings,
  parseBannerInput,
  parseCustomTiles,
  parseFeatures,
  parseHomeSections,
  parseSettings,
  parseTheme,
  toPublicBanner,
} from '../utils/appConfig.js';

const CONFIG_KEY = 'app';
const STALE_SAVE =
  'Someone else published this section since you opened it. Reload to see their changes, then try again.';

const liveBannerFilter = (now) => ({
  active: true,
  $and: [
    { $or: [{ startAt: null }, { startAt: { $lte: now } }] },
    { $or: [{ endAt: null }, { endAt: { $gt: now } }] },
  ],
});

// init() resolves once the unique `key` index is built (cached after the
// first call), which is what makes concurrent first saves safe.
const ensureConfig = async () => {
  await AppConfig.init();
  await AppConfig.updateOne(
    { key: CONFIG_KEY },
    { $setOnInsert: { key: CONFIG_KEY, version: 0 } },
    { upsert: true },
  ).catch((error) => {
    if (error?.code !== 11000) throw error; // lost a create race: the doc exists now
  });
};

/** What each section stores, as saved in a revision and restored from one. */
const sectionData = (config, section) => {
  switch (section) {
    case 'features':
      return { features: config.features ?? [], customTiles: config.customTiles ?? [] };
    case 'homeSections':
      return { homeSections: config.homeSections ?? [] };
    case 'theme':
      return { theme: config.theme ?? { light: {}, dark: {} } };
    case 'settings':
      return { settings: config.settings ?? {} };
    default:
      return {};
  }
};

const pruneRevisions = async (section) => {
  const stale = await AppConfigRevision.find({ section })
    .sort({ createdAt: -1 })
    .skip(REVISIONS_KEPT)
    .select('_id')
    .lean();
  if (stale.length) await AppConfigRevision.deleteMany({ _id: { $in: stale.map((r) => r._id) } });
};

/**
 * Publish one section of the config singleton: bump the global version (the
 * app's cache key) and that section's version (the CMS's lock), then keep a
 * revision for rollback. With `expected` set, a save on top of a newer save
 * of the *same section* is refused. Saves never upsert with the version
 * filter: a mismatch must fail, not insert a second singleton.
 */
const saveSection = async (section, set, req, { expected, note, restoredFrom } = {}) => {
  await ensureConfig();
  const filter = { key: CONFIG_KEY };
  const field = `sectionVersions.${section}`;
  if (Number.isInteger(expected)) {
    // A config saved before per-section versions existed has no counter
    // yet; the CMS reads that as 0.
    if (expected === 0) filter.$or = [{ [field]: 0 }, { [field]: { $exists: false } }];
    else filter[field] = expected;
  }
  const config = await AppConfig.findOneAndUpdate(
    filter,
    {
      $set: { ...set, updatedBy: req.userId },
      $inc: { version: 1, [field]: 1 },
    },
    { new: true },
  ).lean();
  if (!config) return { conflict: STALE_SAVE };

  try {
    await AppConfigRevision.create({
      section,
      data: sectionData(config, section),
      sectionVersion: config.sectionVersions?.[section] ?? 0,
      note: note ?? null,
      restoredFrom: restoredFrom ?? null,
      createdBy: req.userId,
    });
    await pruneRevisions(section);
  } catch (error) {
    // History is a convenience; a failed snapshot must not fail the publish.
    logger.error('cms_revision_failed', {
      action: 'cms_revision_failed',
      section,
      error: error.message,
    });
  }
  return { config };
};

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
});

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
    res.set('Cache-Control', 'no-cache');
    return sendResponse(res, HTTP_STATUS.OK, 'App config fetched', {
      version: config?.version ?? 0,
      features: mergeFeatures(config?.features).map(
        ({ defaults: _d, icon: _i, route: _r, ...f }) => f,
      ),
      customTiles: (config?.customTiles ?? []).map(publicTile),
      homeSections: mergeHomeSections(config?.homeSections).map(({ label: _l, ...s }) => s),
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

/* ---------------------------------- CMS ---------------------------------- */

const editableState = (config) => ({
  version: config?.version ?? 0,
  sectionVersions: {
    features: config?.sectionVersions?.features ?? 0,
    homeSections: config?.sectionVersions?.homeSections ?? 0,
    theme: config?.sectionVersions?.theme ?? 0,
    settings: config?.sectionVersions?.settings ?? 0,
  },
  updatedAt: config?.updatedAt ?? null,
  updatedBy: config?.updatedBy ?? null,
  features: mergeFeatures(config?.features),
  customTiles: (config?.customTiles ?? []).map(publicTile),
  homeSections: mergeHomeSections(config?.homeSections),
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
  const saved = await saveSection(section, set, req, { expected: req.body?.version });
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
    return await publish(req, res, {
      section: 'features',
      set: { features: parsed.features, customTiles: tiles.tiles },
      audit: AUDIT_ACTIONS.CMS_FEATURES_UPDATED,
      message: 'Features published',
      metadata: {
        hidden: parsed.features.filter((f) => !f.enabled).map((f) => f.key),
        linkTiles: tiles.tiles.length,
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

    const saved = await saveSection(revision.section, set, req, {
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
