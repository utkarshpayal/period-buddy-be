/**
 * Tiny in-process TTL cache for admin-curated, non-per-user reads
 * (wellbeing resources, health issues, schemes, subscription catalogue,
 * cycle-sync tips/eras). This API runs as a single instance, so a write on
 * this process invalidating the namespace is enough for edits to show at
 * once; the TTL only bounds staleness for writes that skip invalidation.
 *
 * Cached values are shared between requests: treat them as read-only.
 */

export const MEMO_TTL_MS = 60 * 1000;
const MAX_ENTRIES = 500;

export const createMemoCache = ({
  ttlMs = MEMO_TTL_MS,
  maxEntries = MAX_ENTRIES,
  now = Date.now,
} = {}) => {
  const entries = new Map(); // key -> { value, expiresAt }
  const inFlight = new Map(); // key -> { promise, generation }
  // Bumped by every invalidation, so a load that started before a write
  // can't store the pre-write result after the write invalidated it.
  let generation = 0;

  const store = (key, value) => {
    if (entries.size >= maxEntries && !entries.has(key)) {
      // Oldest insertion first (Map keeps insertion order).
      entries.delete(entries.keys().next().value);
    }
    entries.set(key, { value, expiresAt: now() + ttlMs });
  };

  /** The cached value for `key`, or `await loader()` (stored for ttlMs). */
  const memo = async (key, loader) => {
    const hit = entries.get(key);
    if (hit && hit.expiresAt > now()) return hit.value;
    if (hit) entries.delete(key);

    const pending = inFlight.get(key);
    if (pending && pending.generation === generation) return pending.promise;

    const startedAt = generation;
    const promise = (async () => {
      try {
        const value = await loader();
        if (startedAt === generation) store(key, value);
        return value;
      } finally {
        if (inFlight.get(key)?.promise === promise) inFlight.delete(key);
      }
    })();
    inFlight.set(key, { promise, generation: startedAt });
    return promise;
  };

  /** Drop every key starting with `prefix` (all keys when omitted). */
  const invalidate = (prefix = '') => {
    generation += 1;
    for (const key of [...entries.keys()]) {
      if (key.startsWith(prefix)) entries.delete(key);
    }
  };

  return { memo, invalidate, size: () => entries.size };
};

const shared = createMemoCache();

export const memo = shared.memo;
export const invalidateMemo = shared.invalidate;

// Every Mongoose write path a CMS/admin handler, the seeder or a script
// can take. Document and query middleware both register under these names.
const WRITE_HOOKS = [
  'save',
  'insertMany',
  'updateOne',
  'updateMany',
  'replaceOne',
  'deleteOne',
  'deleteMany',
  'findOneAndUpdate',
  'findOneAndReplace',
  'findOneAndDelete',
];

/**
 * Mongoose plugin: `schema.plugin(invalidateMemoOnWrite, { prefix: 'wellbeing:' })`
 * drops the namespace after any write to the collection, whoever makes it.
 * A query can opt out with the `skipMemoInvalidation: true` option (e.g. a
 * per-read stats counter that doesn't change what's listed).
 */
export const invalidateMemoOnWrite = (schema, { prefix }) => {
  if (!prefix) throw new Error('invalidateMemoOnWrite: prefix is required');
  const handler = function () {
    if (typeof this?.getOptions === 'function' && this.getOptions().skipMemoInvalidation) return;
    invalidateMemo(prefix);
  };
  for (const hook of WRITE_HOOKS) {
    schema.post(hook, { document: true, query: true }, handler);
  }
};
