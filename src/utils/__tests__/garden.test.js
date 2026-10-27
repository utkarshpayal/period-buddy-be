import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DAILY_XP_CAP,
  HOUR_MS,
  MAX_CATCH_UP_TICKS,
  MAX_WEEDS,
  XP,
  XP_PER_LEVEL,
  advanceGarden,
  applyAction,
  describeGarden,
  grantSupplies,
  levelOf,
  newGarden,
  seedOf,
  targetHealth,
} from '../garden.js';

const T0 = Date.UTC(2026, 9, 26, 8);
const at = (hours) => T0 + hours * HOUR_MS;
const SEED = seedOf('6ade2843ecb3fbea40324de5');
const DAY = '2026-10-26';

test('water drains over about a day; mulch halves it', () => {
  const g = { ...newGarden(T0), moisture: 100 };
  const day = advanceGarden(g, at(24), SEED);
  assert.ok(day.moisture < 30 && day.moisture > 15, `moisture ${day.moisture}`);
  const mulched = advanceGarden({ ...g, mulchUntil: g.tick + 72 }, at(24), SEED);
  assert.ok(mulched.moisture > 55);
  assert.ok(advanceGarden(g, at(48), SEED).moisture === 0);
});

test('the simulation is deterministic and catches up at most two weeks', () => {
  const g = newGarden(T0);
  assert.deepEqual(advanceGarden(g, at(100), SEED), advanceGarden(g, at(100), SEED));
  // Advancing in two steps gives the same as one.
  assert.deepEqual(
    advanceGarden(advanceGarden(g, at(40), SEED), at(100), SEED),
    advanceGarden(g, at(100), SEED),
  );
  const year = advanceGarden(g, at(24 * 365), SEED);
  assert.equal(year.tick, g.tick + 24 * 365);
  assert.ok(MAX_CATCH_UP_TICKS === 14 * 24);
});

test('neglect brings weeds, pests and dry leaves, and health falls', () => {
  const g = advanceGarden(newGarden(T0), at(24 * 7), SEED);
  assert.ok(g.weeds.length > 0 && g.weeds.length <= MAX_WEEDS);
  assert.ok(g.deadLeaves.length > 0, 'dry for days → dry leaves');
  assert.ok(g.health < 50, `health ${g.health}`);
  const ids = [...g.weeds, ...g.pests, ...g.deadLeaves].map((x) => x.id);
  assert.equal(new Set(ids).size, ids.length, 'ids are unique');
});

test('watering: more pours more, too much makes the roots soggy', () => {
  const dry = { ...newGarden(T0), moisture: 10 };
  const a = applyAction(dry, { type: 'water', seconds: 1 }, { now: T0, dayKey: DAY });
  assert.equal(a.state.moisture, 25);
  assert.equal(a.xp, XP.water);
  const b = applyAction(dry, { type: 'water', seconds: 3 }, { now: T0, dayKey: DAY });
  assert.equal(b.state.moisture, 55);
  const wet = applyAction(
    { ...dry, moisture: 90 },
    { type: 'water', seconds: 3 },
    { now: T0, dayKey: DAY },
  );
  assert.ok(wet.state.soggyUntil > dry.tick);
  assert.equal(wet.xp, 0);
  assert.ok(
    targetHealth(wet.state, dry.tick) < targetHealth({ ...wet.state, soggyUntil: 0 }, dry.tick),
  );
});

test('only real weeds/bugs/leaves can be removed', () => {
  const g = {
    ...newGarden(T0),
    weeds: [{ id: 4, x: 0.5, z: 0.2 }],
    pests: [{ id: 5, leaf: 10 }],
    deadLeaves: [{ id: 6, leaf: 3 }],
  };
  assert.match(applyAction(g, { type: 'weed', id: 99 }, { now: T0, dayKey: DAY }).error, /gone/);
  const w = applyAction(g, { type: 'weed', id: 4 }, { now: T0, dayKey: DAY });
  assert.equal(w.state.weeds.length, 0);
  assert.equal(g.weeds.length, 1, 'input not mutated');
  assert.equal(
    applyAction(g, { type: 'shoo', id: 5 }, { now: T0, dayKey: DAY }).state.pests.length,
    0,
  );
  assert.equal(
    applyAction(g, { type: 'prune', id: 6 }, { now: T0, dayKey: DAY }).state.deadLeaves.length,
    0,
  );
  assert.match(applyAction(g, { type: 'dance' }, { now: T0, dayKey: DAY }).error, /type must be/);
});

test('compost and mulch use supplies and refuse when not needed', () => {
  const g = { ...newGarden(T0), nutrients: 20, compost: 1, mulch: 1 };
  const fed = applyAction(g, { type: 'fertilize' }, { now: T0, dayKey: DAY });
  assert.equal(fed.state.nutrients, 70);
  assert.equal(fed.state.compost, 0);
  assert.match(
    applyAction(fed.state, { type: 'fertilize' }, { now: T0, dayKey: DAY }).error,
    /compost/,
  );
  assert.match(
    applyAction({ ...g, nutrients: 90 }, { type: 'fertilize' }, { now: T0, dayKey: DAY }).error,
    /hungry/,
  );
  const m = applyAction(g, { type: 'mulch' }, { now: T0, dayKey: DAY });
  assert.ok(describeGarden(m.state, T0).mulched);
  assert.match(
    applyAction({ ...m.state, mulch: 1 }, { type: 'mulch' }, { now: T0, dayKey: DAY }).error,
    /fresh/,
  );
});

test('XP is capped per day, watering XP three times a day; levels unlock decorations', () => {
  let s = { ...newGarden(T0), moisture: 0 };
  let total = 0;
  for (let i = 0; i < 5; i++) {
    s = { ...s, moisture: 0 };
    const r = applyAction(s, { type: 'water', seconds: 1 }, { now: T0, dayKey: DAY });
    total += r.xp;
    s = r.state;
  }
  assert.equal(total, XP.water * 3);
  for (let i = 0; i < 40; i++) {
    s = { ...s, weeds: [{ id: 1000 + i, x: 0, z: 0 }] };
    s = applyAction(s, { type: 'weed', id: 1000 + i }, { now: T0, dayKey: DAY }).state;
  }
  assert.equal(s.xpToday, DAILY_XP_CAP);
  // New day resets the cap.
  s = { ...s, weeds: [{ id: 1, x: 0, z: 0 }] };
  assert.equal(
    applyAction(s, { type: 'weed', id: 1 }, { now: T0, dayKey: '2026-10-27' }).xp,
    XP.weed,
  );
  assert.equal(levelOf(XP_PER_LEVEL * 2), 3);
  const view = describeGarden({ ...s, xp: XP_PER_LEVEL * 2 }, T0);
  assert.deepEqual(view.decorations, ['bench', 'lantern']);
  assert.equal(view.nextDecoration.key, 'birdhouse');
});

test('supplies come from day logs and habits, capped', () => {
  const g = { ...newGarden(T0), compost: 4, mulch: 0 };
  const after = grantSupplies(g, { logDays: 3, habitDays: 5 });
  assert.equal(after.compost, 5);
  assert.equal(after.mulch, 2);
});

test('needs list what to do', () => {
  const g = {
    ...newGarden(T0),
    moisture: 10,
    nutrients: 5,
    weeds: [{ id: 1, x: 0, z: 0 }],
    pests: [],
    deadLeaves: [],
  };
  const keys = describeGarden(g, T0).needs.map((n) => n.key);
  assert.deepEqual(keys, ['water', 'weed', 'fertilize']);
});
