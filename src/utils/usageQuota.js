import UsageCounter from '../models/UsageCounter.js';
import { QUOTAS, limitFor, periodKey, periodResetsAt } from './pricing.js';

/**
 * Counts one unit of `quotaKey` for `userId` in the current period, refusing
 * when `limit` units were already used. One atomic update: the filter only
 * matches while `count < limit`, so at the limit the upsert collides with the
 * existing row (duplicate key) instead of incrementing it. With no limit
 * (fair use off) it still counts, for the admin usage overview.
 *
 * @returns {Promise<{ allowed: boolean, used: number, limit: number|null, period: string, resetsAt: Date }>}
 */
export const consumeQuota = async ({ userId, quotaKey, limit, now = new Date() }) => {
  const kind = QUOTAS[quotaKey]?.period || 'month';
  const period = periodKey(kind, now);
  const resetsAt = periodResetsAt(kind, now);
  const filter = { user: userId, key: quotaKey, period };
  if (limit != null && limit <= 0) return { allowed: false, used: 0, limit, period, resetsAt };
  try {
    const doc = await UsageCounter.findOneAndUpdate(
      limit == null ? filter : { ...filter, count: { $lt: limit } },
      { $inc: { count: 1 } },
      { upsert: true, new: true },
    );
    return { allowed: true, used: doc.count, limit, period, resetsAt };
  } catch (error) {
    if (error?.code === 11000) return { allowed: false, used: limit, limit, period, resetsAt };
    throw error;
  }
};

/** Gives back a unit claimed for a request that then failed. */
export const releaseQuota = async ({ userId, quotaKey, period }) =>
  UsageCounter.updateOne(
    { user: userId, key: quotaKey, period, count: { $gt: 0 } },
    { $inc: { count: -1 } },
  );

/** Used and remaining units of every counted action this period, for
 * GET /api/subscriptions/me. `limit: null` = no limit. */
export const getUsageSummary = async ({ userId, fairUse, tier, now = new Date() }) => {
  const entries = Object.entries(QUOTAS);
  const periods = entries.map(([, q]) => periodKey(q.period, now));
  const counters = await UsageCounter.find({ user: userId, period: { $in: periods } }).lean();
  return entries.map(([key, q]) => {
    const period = periodKey(q.period, now);
    const used = counters.find((c) => c.key === key && c.period === period)?.count || 0;
    const limit = limitFor(fairUse, key, tier);
    return {
      key,
      period: q.period,
      used,
      limit,
      remaining: limit == null ? null : Math.max(0, limit - used),
      resetsAt: periodResetsAt(q.period, now),
    };
  });
};
