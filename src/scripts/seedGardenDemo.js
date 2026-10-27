/* eslint-disable no-console -- a CLI tool: its output is the point. */
/**
 * Sets up the forest care game (utils/garden.js) for ONE test account, so
 * every care action can be tried at once:
 *
 *   node src/scripts/seedGardenDemo.js --email you@example.com            (dry run)
 *   node src/scripts/seedGardenDemo.js --email you@example.com --apply
 *   node src/scripts/seedGardenDemo.js --email you@example.com --remove --apply
 *
 * The garden ends up thirsty and hungry with weeds, bugs and dry leaves,
 * full compost and mulch, today's XP cap reset, and level 6 (bench, lantern,
 * birdhouse, pond and fairy lights). Only the account's ForestGarden row is
 * touched; --remove deletes it (the app then starts a fresh garden).
 */
import 'dotenv/config';
import { connectDB, disconnectDB } from '../config/database.js';
import ForestGarden from '../models/ForestGarden.js';
import User from '../models/User.js';
import { MAX_COMPOST, MAX_MULCH, XP_PER_LEVEL, describeGarden, tickOf } from '../utils/garden.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const email = arg('email')?.toLowerCase();
const apply = process.argv.includes('--apply');
const remove = process.argv.includes('--remove');

if (!email) {
  console.error(
    'usage: node src/scripts/seedGardenDemo.js --email you@example.com [--remove] [--apply]',
  );
  process.exit(1);
}

const run = async () => {
  const conn = await connectDB();
  console.log(`Database: ${conn?.connection?.host ?? 'connected'}`);
  const user = await User.findOne({ email }).select('_id email');
  if (!user) throw new Error(`No account for ${email}`);
  console.log(
    `Account:  ${user.email} (${user._id})${apply ? '' : '  [DRY RUN: add --apply to write]'}`,
  );

  if (remove) {
    if (apply) await ForestGarden.deleteOne({ userId: user._id });
    console.log(apply ? 'Removed the garden.' : 'Would remove the garden.');
    return;
  }

  const now = Date.now();
  const today = new Date().toISOString().slice(0, 10);
  const state = {
    tick: tickOf(now),
    moisture: 18,
    nutrients: 22,
    health: 55,
    soggyUntil: 0,
    mulchUntil: 0,
    weeds: [
      { id: 9001, x: 0.62, z: 0.48 },
      { id: 9002, x: -0.7, z: 0.35 },
      { id: 9003, x: 0.15, z: 0.85 },
    ],
    pests: [
      { id: 9101, leaf: 137 },
      { id: 9102, leaf: 512 },
    ],
    deadLeaves: [
      { id: 9201, leaf: 33 },
      { id: 9202, leaf: 401 },
      { id: 9203, leaf: 777 },
    ],
    nextId: 9300,
    compost: MAX_COMPOST,
    mulch: MAX_MULCH,
    xp: XP_PER_LEVEL * 5 + 40,
    xpDay: '',
    xpToday: 0,
    waterXpToday: 0,
    suppliesGrantedThrough: today,
  };
  const view = describeGarden(state, now);
  console.log(
    `Garden:   water ${view.moisture}, food ${view.nutrients}, health ${view.health}; ` +
      `${state.weeds.length} weeds, ${state.pests.length} bugs, ${state.deadLeaves.length} dry leaves; ` +
      `compost ${state.compost}, mulch ${state.mulch}; level ${view.level} (${view.decorations.join(', ')})`,
  );
  if (apply) {
    await ForestGarden.updateOne({ userId: user._id }, { $set: state }, { upsert: true });
    console.log('Done.');
  }
};

run()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => disconnectDB());
