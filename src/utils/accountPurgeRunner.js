import User from '../models/User.js';
import logger from './logger.js';
import { purgeAccount } from './accountLifecycle.js';

/**
 * Wipes accounts deleted in the app once their grace period is over.
 *
 * "Delete account" in the app (softDeleteAccount) signs the person out and
 * tears down everything other people can see right away, but keeps their
 * data for ACCOUNT_PURGE_AFTER_DAYS (30 by default): a short window for
 * support to deal with anything still open on the account (a payment
 * dispute, a safety report) before it's gone. After that the account and its data are
 * purged for good (purgeAccount), the same as the public "delete my data"
 * flow. Suspended accounts are never touched: they aren't deleted.
 *
 * Runs hourly; a few accounts per tick so a backlog can't hog the database.
 * Safe in more than one instance: purgeAccount is idempotent.
 */

const TICK_MS = 60 * 60 * 1000;
const BATCH = 20;
export const PURGE_AFTER_DAYS = Math.max(1, Number(process.env.ACCOUNT_PURGE_AFTER_DAYS) || 30);

let tickHandle = null;
let ticking = false;

/** Deleted accounts past the grace period, oldest first. */
export const duePurges = (now = new Date(), limit = BATCH) =>
  User.find({
    isActive: false,
    deletedAt: { $ne: null, $lte: new Date(now.getTime() - PURGE_AFTER_DAYS * 86_400_000) },
  })
    .sort({ deletedAt: 1 })
    .limit(limit)
    .select('_id')
    .lean();

export const runDuePurges = async (now = new Date()) => {
  const due = await duePurges(now);
  let purged = 0;
  for (const { _id } of due) {
    try {
      await purgeAccount(_id);
      purged += 1;
    } catch (error) {
      logger.error('account_purge_failed', {
        action: 'account_purge_failed',
        userId: String(_id),
        error: error.message,
      });
    }
  }
  return purged;
};

const tick = async () => {
  if (ticking) return;
  ticking = true;
  try {
    const purged = await runDuePurges();
    if (purged)
      logger.info('accounts_purged', {
        action: 'accounts_purged',
        count: purged,
        afterDays: PURGE_AFTER_DAYS,
      });
  } catch (error) {
    logger.error('account_purge_tick_failed', {
      action: 'account_purge_tick_failed',
      error: error.message,
    });
  } finally {
    ticking = false;
  }
};

/** Started from index.js with the other schedulers. */
export const startAccountPurgeRunner = () => {
  if (tickHandle) return;
  setTimeout(tick, 2 * 60 * 1000).unref();
  tickHandle = setInterval(tick, TICK_MS);
  tickHandle.unref();
};

export const stopAccountPurgeRunner = () => {
  if (tickHandle) clearInterval(tickHandle);
  tickHandle = null;
};
