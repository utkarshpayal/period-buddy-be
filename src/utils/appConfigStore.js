import AppConfig from '../models/AppConfig.js';
import AppConfigRevision, { REVISIONS_KEPT } from '../models/AppConfigRevision.js';
import logger from './logger.js';

// Writes to the AppConfig singleton, shared by the CMS controller and the
// launch schedule runner (utils/launchScheduleRunner.js).

export const CONFIG_KEY = 'app';
const STALE_SAVE =
  'Someone else published this section since you opened it. Reload to see their changes, then try again.';

// init() resolves once the unique `key` index is built (cached after the
// first call), which is what makes concurrent first saves safe.
export const ensureConfig = async () => {
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
    case 'screenSections':
      return {
        screenSections: config.screenSections ?? {},
        screenTitles: config.screenTitles ?? {},
      };
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
 * revision for rollback. `userId` is the staff member (null for the
 * schedule runner). With `expected` set, a save on top of a newer save
 * of the *same section* is refused. Saves never upsert with the version
 * filter: a mismatch must fail, not insert a second singleton.
 */
export const saveSection = async (section, set, userId, { expected, note, restoredFrom } = {}) => {
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
      $set: { ...set, updatedBy: userId ?? null },
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
      createdBy: userId ?? null,
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
