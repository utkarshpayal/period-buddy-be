import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_LAUNCH,
  acceptsNotify,
  applyDueSchedules,
  effectiveState,
  isItemKey,
  mergeLaunch,
  parseLaunch,
  resolveLaunch,
  rolloutBucket,
  testerKind,
} from '../launch.js';

const NOW = new Date('2026-09-27T10:00:00Z');
const LATER = '2026-10-01T04:30:00.000Z';
const EARLIER = '2026-09-20T04:30:00.000Z';
const nobody = { userId: null, deviceId: null, onList: new Set() };

const launch = (patch = {}) => {
  const base = mergeLaunch(null);
  return {
    ...base,
    ...patch,
    rollout: { ...base.rollout, ...(patch.rollout || {}) },
    soon: { ...base.soon, ...(patch.soon || {}) },
    paused: { ...base.paused, ...(patch.paused || {}) },
  };
};

test('mergeLaunch fills a missing launch with the Live default', () => {
  const merged = mergeLaunch(undefined);
  assert.equal(merged.state, 'live');
  assert.deepEqual(merged.rollout, DEFAULT_LAUNCH.rollout);
  assert.equal(merged.soon.notifyMe, true);
  assert.deepEqual(merged.testers, []);
});

test('parseLaunch validates and sets since only when the state changes', () => {
  const r = parseLaunch(
    { state: 'coming_soon', soon: { message: 'Soon!', goLiveAt: LATER } },
    null,
    NOW,
  );
  assert.equal(r.error, undefined);
  assert.equal(r.launch.state, 'coming_soon');
  assert.equal(r.launch.soon.goLiveAt, LATER);
  assert.equal(r.launch.since, NOW.toISOString());

  const again = parseLaunch({ state: 'coming_soon' }, r.launch, new Date('2026-09-28T00:00:00Z'));
  assert.equal(again.launch.since, NOW.toISOString());
});

test('parseLaunch refuses bad input', () => {
  const bad = [
    { state: 'nope' },
    { state: 'rolling_out', rollout: { percent: 101 } },
    { state: 'rolling_out', rollout: { percent: 12.5 } },
    { state: 'coming_soon', soon: { headline: 'custom' } },
    { state: 'coming_soon', soon: { goLiveAt: EARLIER } },
    { state: 'paused', paused: { resumeAt: 'tomorrow' } },
    { state: 'paused', paused: { alternative: { type: 'url', value: 'http://x.com' } } },
    { testers: ['not a tester'] },
  ];
  for (const raw of bad) assert.ok(parseLaunch(raw, null, NOW).error, JSON.stringify(raw));
});

test('parseLaunch keeps a past schedule that was already saved, and drops ones that do not apply', () => {
  const saved = launch({ state: 'coming_soon', soon: { goLiveAt: EARLIER } });
  const r = parseLaunch({ state: 'coming_soon', soon: { goLiveAt: EARLIER } }, saved, NOW);
  assert.equal(r.error, undefined);
  assert.equal(r.launch.soon.goLiveAt, EARLIER);

  const live = parseLaunch(
    { state: 'live', soon: { goLiveAt: LATER }, paused: { resumeAt: LATER } },
    null,
    NOW,
  );
  assert.equal(live.launch.soon.goLiveAt, null);
  assert.equal(live.launch.paused.resumeAt, null);
});

test('parseLaunch returns tester entries for the controller to resolve', () => {
  const r = parseLaunch(
    { testers: ['a@b.co', ' +91 98765 43210 ', 'a@b.co', '64b7f0c2a1b2c3d4e5f60718'] },
    null,
    NOW,
  );
  assert.deepEqual(r.testers, ['a@b.co', '+91 98765 43210', '64b7f0c2a1b2c3d4e5f60718']);
  assert.equal(testerKind('a@b.co'), 'email');
  assert.equal(testerKind('+91 98765 43210'), 'phone');
  assert.equal(testerKind('64b7f0c2a1b2c3d4e5f60718'), 'id');
});

test('effectiveState treats a passed go-live or resume time as done', () => {
  assert.equal(
    effectiveState(launch({ state: 'coming_soon', soon: { goLiveAt: EARLIER } }), NOW),
    'live',
  );
  assert.equal(
    effectiveState(launch({ state: 'coming_soon', soon: { goLiveAt: LATER } }), NOW),
    'coming_soon',
  );
  assert.equal(
    effectiveState(
      launch({ state: 'paused', resumeTo: 'rolling_out', paused: { resumeAt: EARLIER } }),
      NOW,
    ),
    'rolling_out',
  );
});

test('rolloutBucket is stable, 0-99, and differs between items', () => {
  const a = rolloutBucket('consultation', 'user-1');
  assert.equal(a, rolloutBucket('consultation', 'user-1'));
  assert.ok(a >= 0 && a < 100);
  const buckets = new Set(Array.from({ length: 200 }, (_, i) => rolloutBucket('x', `d${i}`)));
  assert.ok(buckets.size > 50);
  const same = Array.from(
    { length: 50 },
    (_, i) => rolloutBucket('a', `u${i}`) === rolloutBucket('b', `u${i}`),
  );
  assert.ok(same.filter(Boolean).length < 10);
});

test('resolveLaunch: live, coming soon and paused', () => {
  assert.equal(resolveLaunch('k', launch(), nobody, NOW).launch.access, 'open');
  assert.equal(resolveLaunch('k', launch(), nobody, NOW).plainOpen, true);

  const soon = resolveLaunch(
    'k',
    launch({ state: 'coming_soon', soon: { headline: 'this_month' } }),
    nobody,
    NOW,
  );
  assert.equal(soon.launch.access, 'soon');
  assert.equal(soon.plainOpen, false);
  assert.equal(soon.launch.sheet.headline, 'Coming this month');
  assert.equal(soon.launch.sheet.notifyMe, true);

  const withLabel = parseLaunch(
    {
      state: 'paused',
      paused: {
        alternative: { type: 'url', value: 'https://thenura.care/help' },
        alternativeLabel: 'Get help',
      },
    },
    null,
    NOW,
  );
  assert.equal(
    resolveLaunch('k', withLabel.launch, nobody, NOW).launch.sheet.alternativeLabel,
    'Get help',
  );

  const paused = resolveLaunch('k', launch({ state: 'paused' }), nobody, NOW);
  assert.equal(paused.launch.access, 'paused');
  assert.equal(paused.launch.sheet.headline, 'Taking a short break');
  assert.equal(paused.launch.sheet.notifyMe, false);
});

test('resolveLaunch: testers always get it', () => {
  const l = launch({ state: 'coming_soon', testers: [{ id: 'u1', label: 'a@b.co' }] });
  assert.equal(resolveLaunch('k', l, { ...nobody, userId: 'u1' }, NOW).launch.access, 'open');
  assert.equal(resolveLaunch('k', l, { ...nobody, userId: 'u2' }, NOW).launch.access, 'soon');
});

test('resolveLaunch: rolling out by percent, slice audience and what others see', () => {
  const ids = Array.from({ length: 400 }, (_, i) => `user-${i}`);
  const inCount = (l) =>
    ids.filter(
      (id) => resolveLaunch('k', l, { ...nobody, userId: id }, NOW).launch?.access === 'open',
    ).length;
  const quarter = inCount(launch({ state: 'rolling_out', rollout: { percent: 25 } }));
  assert.ok(quarter > 60 && quarter < 140, String(quarter));

  // Raising the percentage only adds people.
  const at10 = ids.filter((id) => rolloutBucket('k', id) < 10);
  const l25 = launch({ state: 'rolling_out', rollout: { percent: 25 } });
  for (const id of at10)
    assert.equal(resolveLaunch('k', l25, { ...nobody, userId: id }, NOW).launch.access, 'open');

  // No id at all: out unless at 100%.
  assert.equal(resolveLaunch('k', l25, nobody, NOW).launch.access, 'soon');
  assert.equal(
    resolveLaunch('k', launch({ state: 'rolling_out', rollout: { percent: 100 } }), nobody, NOW)
      .launch.access,
    'open',
  );

  const hidden = launch({ state: 'rolling_out', rollout: { percent: 0, othersSee: 'hidden' } });
  const h = resolveLaunch('k', hidden, { ...nobody, userId: 'u' }, NOW);
  assert.equal(h.hidden, true);
  // Still locked, so the app's route guard keeps stale links out.
  assert.equal(h.launch.access, 'soon');
  assert.equal(h.launch.sheet.notifyMe, false);

  const android = launch({
    state: 'rolling_out',
    rollout: {
      percent: 100,
      betaLabel: true,
      audience: {
        segment: 'all',
        platforms: ['android'],
        minAppVersion: null,
        maxAppVersion: null,
      },
    },
  });
  const r = resolveLaunch('k', android, nobody, NOW);
  assert.equal(r.launch.access, 'open');
  assert.equal(r.launch.beta, true);
  assert.deepEqual(r.launch.openFor.platforms, ['android']);
  assert.equal(r.launch.fallback, 'soon');
  assert.equal(r.plainOpen, false);
});

test('resolveLaunch reports whether the viewer is on the Notify me list', () => {
  const l = launch({ state: 'coming_soon' });
  const r = resolveLaunch(
    'k',
    l,
    { ...nobody, deviceId: 'dev-123456', onList: new Set(['k']) },
    NOW,
  );
  assert.equal(r.launch.sheet.onList, true);
});

test('acceptsNotify only while coming soon or rolling out with Notify me on', () => {
  assert.equal(acceptsNotify(launch({ state: 'coming_soon' }), NOW), true);
  assert.equal(
    acceptsNotify(launch({ state: 'coming_soon', soon: { notifyMe: false } }), NOW),
    false,
  );
  assert.equal(acceptsNotify(launch({ state: 'live' }), NOW), false);
  assert.equal(
    acceptsNotify(launch({ state: 'coming_soon', soon: { goLiveAt: EARLIER } }), NOW),
    false,
  );
});

test('applyDueSchedules flips due items and clears the schedule', () => {
  const features = [
    { key: 'a', launch: launch({ state: 'coming_soon', soon: { goLiveAt: EARLIER } }) },
    { key: 'b', launch: launch({ state: 'coming_soon', soon: { goLiveAt: LATER } }) },
    { key: 'c' },
  ];
  const tiles = [
    {
      id: 'abc123',
      title: 'Retreat',
      launch: launch({ state: 'paused', paused: { resumeAt: EARLIER } }),
    },
  ];
  const r = applyDueSchedules(features, tiles, NOW);
  assert.deepEqual(
    r.changes.map((c) => [c.itemKey, c.from, c.to]),
    [
      ['a', 'coming_soon', 'live'],
      ['link:abc123', 'paused', 'live'],
    ],
  );
  assert.equal(r.features[0].launch.state, 'live');
  assert.equal(r.features[0].launch.soon.goLiveAt, null);
  assert.equal(r.features[0].launch.since, NOW.toISOString());
  assert.equal(r.features[1], features[1]);
  assert.equal(r.customTiles[0].launch.paused.resumeAt, null);
});

test('isItemKey accepts feature keys and link tile keys only', () => {
  for (const k of ['consultation', 'nuraAi', 'link:abc123def']) assert.equal(isItemKey(k), true, k);
  for (const k of ['', 'link:', 'link:ABC', '../x', 'a b', null])
    assert.equal(isItemKey(k), false, String(k));
});
