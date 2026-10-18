import test from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { createMemoCache, invalidateMemoOnWrite, memo, invalidateMemo } from '../memoCache.js';

const fakeClock = () => {
  let t = 1_000;
  return { now: () => t, advance: (ms) => (t += ms) };
};

test('memo serves the cached value until the TTL passes', async () => {
  const clock = fakeClock();
  const cache = createMemoCache({ ttlMs: 60_000, now: clock.now });
  let loads = 0;
  const loader = async () => ++loads;

  assert.equal(await cache.memo('a', loader), 1);
  assert.equal(await cache.memo('a', loader), 1);
  clock.advance(59_999);
  assert.equal(await cache.memo('a', loader), 1);
  clock.advance(1);
  assert.equal(await cache.memo('a', loader), 2);
});

test('keys are independent and invalidate drops only the prefix', async () => {
  const cache = createMemoCache();
  let loads = 0;
  const loader = async () => ++loads;
  await cache.memo('wellbeing:list:null', loader);
  await cache.memo('schemes:list:1', loader);
  cache.invalidate('wellbeing:');
  assert.equal(await cache.memo('schemes:list:1', loader), 2);
  assert.equal(await cache.memo('wellbeing:list:null', loader), 3);
});

test('concurrent misses share one load', async () => {
  const cache = createMemoCache();
  let loads = 0;
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const loader = async () => {
    loads += 1;
    await gate;
    return 'v';
  };
  const both = Promise.all([cache.memo('k', loader), cache.memo('k', loader)]);
  release();
  assert.deepEqual(await both, ['v', 'v']);
  assert.equal(loads, 1);
});

test('a load that started before an invalidation is not stored', async () => {
  const cache = createMemoCache();
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const stale = cache.memo('k', async () => {
    await gate;
    return 'old';
  });
  cache.invalidate('k');
  release();
  assert.equal(await stale, 'old'); // that request still gets its own read
  assert.equal(await cache.memo('k', async () => 'new'), 'new');
});

test('a failed load is not cached', async () => {
  const cache = createMemoCache();
  await assert.rejects(
    cache.memo('k', async () => {
      throw new Error('db down');
    }),
  );
  assert.equal(await cache.memo('k', async () => 'ok'), 'ok');
});

test('the oldest entry is evicted past maxEntries', async () => {
  const cache = createMemoCache({ maxEntries: 2 });
  let loads = 0;
  const loader = async () => ++loads;
  await cache.memo('a', loader);
  await cache.memo('b', loader);
  await cache.memo('c', loader);
  assert.equal(cache.size(), 2);
  assert.equal(await cache.memo('a', loader), 4);
});

test('invalidateMemoOnWrite drops the namespace from write hooks, unless skipped', async () => {
  const schema = new mongoose.Schema({ name: String });
  schema.plugin(invalidateMemoOnWrite, { prefix: 'memo-test:' });
  const hooks = schema.s.hooks._posts;
  for (const name of ['save', 'findOneAndUpdate', 'updateOne', 'deleteOne', 'insertMany']) {
    assert.ok(hooks.get(name)?.length, `${name} hook registered`);
  }
  const handler = hooks.get('findOneAndUpdate')[0].fn;

  let loads = 0;
  const loader = async () => ++loads;
  await memo('memo-test:list', loader);
  handler.call({ getOptions: () => ({ skipMemoInvalidation: true }) });
  assert.equal(await memo('memo-test:list', loader), 1);
  handler.call({ getOptions: () => ({}) });
  assert.equal(await memo('memo-test:list', loader), 2);
  handler.call({}); // document middleware: `this` is the document
  assert.equal(await memo('memo-test:list', loader), 3);
  invalidateMemo('memo-test:');
});
