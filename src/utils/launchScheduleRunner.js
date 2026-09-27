import AppConfig from '../models/AppConfig.js';
import { CONFIG_KEY, saveSection } from './appConfigStore.js';
import { applyDueSchedules } from './launch.js';
import logger from './logger.js';

/**
 * Publishes App CMS launch schedules (utils/launch.js): a Coming soon or
 * Rolling out item whose "Go live on" time has passed becomes Live, and a
 * Paused item whose "Resume on" time has passed goes back to what it was.
 * Each run that changes something is a normal features publish, so it
 * shows in the CMS History as "Scheduled: …".
 *
 * The app already treats a passed time as done on every fetch, so this only
 * has to make the stored state catch up; a minute late is fine. The save is
 * guarded by the section's version, so two instances (or a CMS publish at
 * the same moment) can't both apply it: the loser retries on its next tick.
 */

const TICK_MS = 60 * 1000;
let tickHandle = null;
let ticking = false;

const describe = (c) =>
  `${c.name} ${c.to === 'live' ? 'went live' : `resumed (${c.to.replace('_', ' ')})`}`;

export const runDueLaunchSchedules = async (now = new Date()) => {
  const config = await AppConfig.findOne({ key: CONFIG_KEY })
    .select('features customTiles sectionVersions')
    .lean();
  if (!config) return { changes: [] };
  const { features, customTiles, changes } = applyDueSchedules(
    config.features,
    config.customTiles,
    now,
  );
  if (!changes.length) return { changes };
  const saved = await saveSection('features', { features, customTiles }, null, {
    expected: config.sectionVersions?.features ?? 0,
    note: `Scheduled: ${changes.map(describe).join(', ')}`,
  });
  return { changes: saved.conflict ? [] : changes, conflict: Boolean(saved.conflict) };
};

const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const result = await runDueLaunchSchedules();
    if (result.changes.length) {
      logger.info('launch_schedule_applied', {
        action: 'launch_schedule_applied',
        changes: result.changes.map((c) => `${c.itemKey}:${c.from}->${c.to}`),
      });
    }
  } catch (error) {
    logger.error('launch_schedule_tick_failed', {
      action: 'launch_schedule_tick_failed',
      error: error.message,
    });
  } finally {
    ticking = false;
  }
};

/** Started from index.js next to the push scheduler; safe in more than one instance. */
export const startLaunchScheduler = () => {
  if (tickHandle) return;
  setTimeout(tick, 20 * 1000).unref();
  tickHandle = setInterval(tick, TICK_MS);
  tickHandle.unref();
};

export const stopLaunchScheduler = () => {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
};
