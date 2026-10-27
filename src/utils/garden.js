/**
 * Wellness Forest care game — pure simulation (no DB, unit-tested in
 * __tests__/garden.test.js). The model is models/ForestGarden.js, the routes
 * GET /api/forest/garden and POST /api/forest/garden/action.
 *
 * The tree lives in real time, one tick per hour, on the server, so the
 * phone can't fake it:
 *  - soil moisture drains (half as fast under mulch), nutrients slowly too;
 *  - weeds sprout, pests come (more often to a weak tree), leaves die when
 *    it's dry or hungry;
 *  - health eases towards a target set by all of that.
 * The person waters (pouring more = more water, too much = soggy roots),
 * pulls weeds, shoos pests, prunes dead leaves, feeds compost and lays mulch.
 * Compost comes from day logs and mulch from habits, so caring for the tree
 * stays tied to caring for yourself. Care earns XP (capped per day) and
 * levels unlock decorations on the island.
 *
 * Growth itself (seed → tree) still comes from utils/forestGrowth.js; the
 * first watering of a day also counts as that day's `water` task.
 */

export const HOUR_MS = 3_600_000;
export const MAX_CATCH_UP_TICKS = 14 * 24;

export const MOISTURE_DRAIN = 3.2; // per hour → about a day from full to dry
export const NUTRIENT_DRAIN = 0.9; // per hour → about 4 days
export const POUR_PER_SECOND = 15;
export const MAX_POUR_SECONDS = 3;
export const SOGGY_HOURS = 6;
export const MULCH_HOURS = 72;
export const FEED_AMOUNT = 50;

export const MAX_WEEDS = 5;
export const MAX_PESTS = 4;
export const MAX_DEAD_LEAVES = 8;
/** Leaves are addressed by slot; the app maps a slot onto one of its tree's leaves. */
export const LEAF_SLOTS = 1000;

export const MAX_COMPOST = 5;
export const MAX_MULCH = 3;
export const XP_PER_LEVEL = 120;
export const DAILY_XP_CAP = 60;
export const XP = { water: 5, weed: 3, shoo: 4, prune: 2, fertilize: 6, mulch: 4 };
/** Waterings that earn XP per day (more still waters, just no XP). */
export const WATER_XP_PER_DAY = 3;

export const DECORATIONS = [
  { key: 'bench', level: 2, label: 'Garden bench' },
  { key: 'lantern', level: 3, label: 'Lantern' },
  { key: 'birdhouse', level: 4, label: 'Birdhouse' },
  { key: 'pond', level: 5, label: 'Little pond' },
  { key: 'fairyLights', level: 6, label: 'Fairy lights' },
  { key: 'swing', level: 8, label: 'Tree swing' },
];

export const ACTIONS = ['water', 'weed', 'shoo', 'prune', 'fertilize', 'mulch'];

export const tickOf = (ms) => Math.floor(ms / HOUR_MS);

/** Stable per-account seed from the user id. */
export const seedOf = (id) => {
  let h = 2166136261;
  for (const c of String(id)) {
    h ^= c.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
};

/** One random number per (account, hour, channel): replaying an hour gives the same result. */
const chance = (seed, tick, channel) => {
  let t = (seed ^ Math.imul(tick + 1, 2654435761) ^ Math.imul(channel + 1, 40503)) >>> 0;
  t = Math.imul(t ^ (t >>> 15), 1 | t);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const round1 = (v) => Math.round(v * 10) / 10;

export const newGarden = (now) => ({
  tick: tickOf(now),
  moisture: 70,
  nutrients: 70,
  health: 80,
  soggyUntil: 0,
  mulchUntil: 0,
  weeds: [],
  pests: [],
  deadLeaves: [],
  nextId: 1,
  compost: 1,
  mulch: 1,
  xp: 0,
  xpDay: '',
  xpToday: 0,
  waterXpToday: 0,
});

/** The health the tree is heading towards, from how it's cared for. */
export const targetHealth = (s, tick) => {
  let t = 100;
  if (s.moisture < 30) t -= (30 - s.moisture) * 1.5;
  if (s.soggyUntil > tick) t -= 15;
  if (s.nutrients < 25) t -= 25 - s.nutrients;
  t -= s.weeds.length * 6 + s.pests.length * 8 + s.deadLeaves.length * 3;
  return clamp(t, 5, 100);
};

/** Runs the hours between the stored tick and `now` (at most two weeks of them). */
export const advanceGarden = (state, now, seed) => {
  const s = {
    ...state,
    weeds: [...state.weeds],
    pests: [...state.pests],
    deadLeaves: [...state.deadLeaves],
  };
  const target = tickOf(now);
  if (target - s.tick > MAX_CATCH_UP_TICKS) s.tick = target - MAX_CATCH_UP_TICKS;
  while (s.tick < target) {
    const h = ++s.tick;
    s.moisture = Math.max(0, s.moisture - MOISTURE_DRAIN * (s.mulchUntil > h ? 0.5 : 1));
    s.nutrients = Math.max(0, s.nutrients - NUTRIENT_DRAIN);
    if (s.weeds.length < MAX_WEEDS && chance(seed, h, 1) < 1 / 16) {
      const a = chance(seed, h, 2) * Math.PI * 2;
      const d = 0.4 + chance(seed, h, 3) * 0.9;
      s.weeds.push({
        id: s.nextId++,
        x: round1(Math.cos(a) * d * 10) / 10,
        z: round1(Math.sin(a) * d * 10) / 10,
      });
    }
    if (s.pests.length < MAX_PESTS && chance(seed, h, 4) < (s.health < 60 ? 1 / 14 : 1 / 40)) {
      s.pests.push({ id: s.nextId++, leaf: Math.floor(chance(seed, h, 5) * LEAF_SLOTS) });
    }
    const stressed = s.moisture < 25 || s.nutrients < 15;
    if (stressed && s.deadLeaves.length < MAX_DEAD_LEAVES && chance(seed, h, 6) < 1 / 6) {
      s.deadLeaves.push({ id: s.nextId++, leaf: Math.floor(chance(seed, h, 7) * LEAF_SLOTS) });
    }
    s.health = s.health + (targetHealth(s, h) - s.health) * 0.06;
  }
  s.moisture = round1(s.moisture);
  s.nutrients = round1(s.nutrients);
  s.health = round1(s.health);
  return s;
};

/** XP after the daily cap; resets the per-day counters on a new day. */
const earn = (s, amount, dayKey) => {
  if (s.xpDay !== dayKey) {
    s.xpDay = dayKey;
    s.xpToday = 0;
    s.waterXpToday = 0;
  }
  const gained = clamp(amount, 0, DAILY_XP_CAP - s.xpToday);
  s.xp += gained;
  s.xpToday += gained;
  return gained;
};

/**
 * Applies one care action to an already-advanced state. Returns
 * { state, xp, message } or { error } (nothing changed).
 */
export const applyAction = (state, action, { now, dayKey }) => {
  const s = {
    ...state,
    weeds: [...state.weeds],
    pests: [...state.pests],
    deadLeaves: [...state.deadLeaves],
  };
  const tick = tickOf(now);
  const type = action?.type;
  if (!ACTIONS.includes(type)) return { error: `type must be one of: ${ACTIONS.join(', ')}` };
  const removeById = (list, what) => {
    const id = Number(action.id);
    const i = s[list].findIndex((x) => x.id === id);
    if (i < 0) return { error: `That ${what} is already gone` };
    s[list].splice(i, 1);
    return null;
  };

  let xp = 0;
  let message;
  switch (type) {
    case 'water': {
      const seconds = clamp(Number(action.seconds) || 1, 0.3, MAX_POUR_SECONDS);
      const before = s.moisture;
      const after = before + seconds * POUR_PER_SECOND;
      s.moisture = round1(Math.min(100, after));
      if (after > 105) {
        s.soggyUntil = tick + SOGGY_HOURS;
        message = 'Too much! The roots are soggy, let it dry out a bit.';
      } else {
        message = before < 30 ? 'Ahh, it really needed that.' : 'Watered.';
      }
      if (before < 85 && after <= 105) {
        if (s.xpDay !== dayKey || s.waterXpToday < WATER_XP_PER_DAY) {
          xp = earn(s, XP.water, dayKey);
          s.waterXpToday += 1;
        }
      }
      break;
    }
    case 'weed': {
      const err = removeById('weeds', 'weed');
      if (err) return err;
      xp = earn(s, XP.weed, dayKey);
      message = 'Weed pulled.';
      break;
    }
    case 'shoo': {
      const err = removeById('pests', 'bug');
      if (err) return err;
      xp = earn(s, XP.shoo, dayKey);
      message = 'Bug shooed away.';
      break;
    }
    case 'prune': {
      const err = removeById('deadLeaves', 'leaf');
      if (err) return err;
      xp = earn(s, XP.prune, dayKey);
      message = 'Trimmed.';
      break;
    }
    case 'fertilize': {
      if (s.compost < 1) return { error: 'No compost left. Log your day to earn more.' };
      if (s.nutrients > 85) return { error: "It isn't hungry yet." };
      s.compost -= 1;
      s.nutrients = round1(Math.min(100, s.nutrients + FEED_AMOUNT));
      xp = earn(s, XP.fertilize, dayKey);
      message = 'Fed with compost.';
      break;
    }
    case 'mulch': {
      if (s.mulch < 1) return { error: 'No mulch left. Complete a habit to earn more.' };
      if (s.mulchUntil > tick) return { error: 'The mulch is still fresh.' };
      s.mulch -= 1;
      s.mulchUntil = tick + MULCH_HOURS;
      xp = earn(s, XP.mulch, dayKey);
      message = 'Mulched: the soil keeps its water for 3 days.';
      break;
    }
  }
  return { state: s, xp, message };
};

/**
 * Supplies earned from real tracking: one compost per day logged, one mulch
 * per two habit days, since the last grant (capped).
 */
export const grantSupplies = (state, { logDays = 0, habitDays = 0 }) => ({
  ...state,
  compost: clamp(state.compost + logDays, 0, MAX_COMPOST),
  mulch: clamp(state.mulch + Math.floor(habitDays / 2), 0, MAX_MULCH),
});

export const levelOf = (xp) => 1 + Math.floor(xp / XP_PER_LEVEL);

/** What the app gets: meters, what needs doing, supplies, level and decorations. */
export const describeGarden = (s, now) => {
  const tick = tickOf(now);
  const level = levelOf(s.xp);
  const needs = [];
  if (s.moisture < 30) needs.push({ key: 'water', label: 'Thirsty', urgent: s.moisture < 15 });
  if (s.soggyUntil > tick) needs.push({ key: 'soggy', label: 'Roots are soggy', urgent: false });
  if (s.weeds.length)
    needs.push({
      key: 'weed',
      label: `${s.weeds.length} weed${s.weeds.length > 1 ? 's' : ''}`,
      urgent: s.weeds.length >= 3,
    });
  if (s.pests.length)
    needs.push({
      key: 'shoo',
      label: `${s.pests.length} bug${s.pests.length > 1 ? 's' : ''}`,
      urgent: s.pests.length >= 2,
    });
  if (s.deadLeaves.length)
    needs.push({ key: 'prune', label: `${s.deadLeaves.length} dry leaves`, urgent: false });
  if (s.nutrients < 30) needs.push({ key: 'fertilize', label: 'Hungry', urgent: s.nutrients < 10 });
  const hoursToDry = Math.max(
    0,
    Math.floor((s.moisture - 30) / (MOISTURE_DRAIN * (s.mulchUntil > tick ? 0.5 : 1))),
  );
  return {
    moisture: Math.round(s.moisture),
    nutrients: Math.round(s.nutrients),
    health: Math.round(s.health),
    soggy: s.soggyUntil > tick,
    mulched: s.mulchUntil > tick,
    mulchHoursLeft: Math.max(0, s.mulchUntil - tick),
    hoursUntilThirsty: s.moisture >= 30 ? hoursToDry : 0,
    weeds: s.weeds,
    pests: s.pests,
    deadLeaves: s.deadLeaves,
    compost: s.compost,
    mulch: s.mulch,
    xp: s.xp,
    level,
    levelProgress: (s.xp % XP_PER_LEVEL) / XP_PER_LEVEL,
    xpToNextLevel: XP_PER_LEVEL - (s.xp % XP_PER_LEVEL),
    xpToday: s.xpDay ? s.xpToday : 0,
    dailyXpCap: DAILY_XP_CAP,
    decorations: DECORATIONS.filter((d) => d.level <= level).map((d) => d.key),
    nextDecoration: DECORATIONS.find((d) => d.level > level) ?? null,
    needs,
  };
};
