/* eslint-disable no-console -- a CLI tool: its output is the point. */
/**
 * Seeds a big Wellness Forest for ONE test account, to try the forest screen.
 *
 *   node src/scripts/seedForestDemo.js --email you@example.com [--trees 100]            (dry run)
 *   node src/scripts/seedForestDemo.js --email you@example.com [--trees 100] --apply
 *   node src/scripts/seedForestDemo.js --email you@example.com --logs 365 [--apply]     (+ a year of day logs)
 *   node src/scripts/seedForestDemo.js --email you@example.com --posts 10 [--apply]     (+ community posts)
 *   node src/scripts/seedForestDemo.js --email you@example.com --remove [--apply]
 *
 * Writes only forest-only data, never health logs:
 *  - one habit titled DEMO_HABIT_TITLE, plus one completion of it per day
 *  - one forest watering per day (ForestLog, careType 'water')
 * Every row is tagged (DEMO_TAG / DEMO_HABIT_TITLE) so --remove deletes exactly
 * what this script added. Both kinds of row count only for the forest.
 *
 * `--logs N` also fills the last N days (not today, never over a day already
 * logged) with realistic day logs that follow the account's cycle settings:
 * flow on period days, phase-typical moods, symptoms, discharge, sleep, water,
 * exercise and a basal temperature that rises after ovulation. These DO show
 * in the calendar, predictions and reports (that's the point). Their ids are
 * kept in logs/forest-demo-<userId>.json (git-ignored) so --remove deletes
 * exactly them. Day logs also count as a forest task, so the script then
 * trims the oldest demo waterings/completions to keep the forest on target.
 *
 * `--posts N` adds N sample community posts by the account over the last few
 * weeks (they show in everyone's community feed). Their ids go in the same
 * manifest, so --remove deletes exactly them too.
 *
 * Target: `--trees` fully grown trees plus the current tree at 59/60 points
 * (in bloom), so one more task grows the next tree. Today gets the habit done
 * (the tree is "thriving") but not the watering or the day log, so those stay
 * free to test. The account must be listed in FOREST_FULL_HISTORY_EMAILS, or
 * the forest only counts the last year.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/database.js';
import CommunityPost from '../models/Community.js';
import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import ForestLog from '../models/ForestLog.js';
import Habit from '../models/Habit.js';
import HabitCompletion from '../models/HabitCompletion.js';
import User from '../models/User.js';
import {
  POINTS_PER_TREE,
  buildTaskDays,
  computeForestGrowth,
  hasCycleEntry,
  shiftDateKey,
} from '../utils/forestGrowth.js';

const DEMO_TAG = 'forest-demo-seed';
const DEMO_HABIT_TITLE = 'Forest test (demo data)';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes('--apply');
const remove = process.argv.includes('--remove');
const email = String(arg('email') || '')
  .trim()
  .toLowerCase();
const trees = Number.parseInt(arg('trees') || '100', 10);
const logDays = Number.parseInt(arg('logs') || '0', 10);
const postCount = Number.parseInt(arg('posts') || '0', 10);

/* ----------------------- Day logs (calendar) ----------------------- */

const manifestPath = (userId) => path.resolve('logs', `forest-demo-${userId}.json`);
const readManifest = (userId) => {
  try {
    return {
      cycleLogIds: [],
      communityPostIds: [],
      ...JSON.parse(fs.readFileSync(manifestPath(userId), 'utf8')),
    };
  } catch {
    return { cycleLogIds: [], communityPostIds: [] };
  }
};
const writeManifest = (userId, manifest) => {
  fs.mkdirSync(path.dirname(manifestPath(userId)), { recursive: true });
  fs.writeFileSync(manifestPath(userId), JSON.stringify(manifest, null, 2));
};

/** Small deterministic random per day, so a re-run makes the same logs. */
const rng = (key, salt) => {
  let h = 2166136261;
  for (const ch of `${key}:${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return ((h >>> 0) % 10000) / 10000;
};
const pick = (list, key, salt) => list[Math.floor(rng(key, salt) * list.length)];
const keyDay = (key) => Math.round(Date.parse(`${key}T00:00:00Z`) / 86400000);

/**
 * Period start days going back from the account's last period, each cycle a
 * little different (as real cycles are).
 */
const periodStarts = (lastStartKey, cycleLength, fromKey) => {
  const starts = [];
  let key = lastStartKey;
  while (key >= fromKey) {
    starts.push(key);
    const len = cycleLength + Math.round((rng(key, 'len') - 0.5) * 3);
    key = shiftDateKey(key, -len);
  }
  starts.push(key);
  return starts.sort();
};

const FLOW = ['medium', 'heavy', 'heavy', 'medium', 'light', 'light', 'spotting'];

/** One realistic day log for `key`, given its cycle day and the cycle's length. */
const demoDayLog = ({ userId, key, cycleDay, cycleLength, periodLength }) => {
  const ovulationDay = cycleLength - 14;
  const phase =
    cycleDay <= periodLength
      ? 'period'
      : cycleDay < ovulationDay - 1
        ? 'follicular'
        : cycleDay <= ovulationDay + 1
          ? 'ovulation'
          : 'luteal';
  const late = phase === 'luteal' && cycleDay >= cycleLength - 5; // PMS days
  const r = (salt) => rng(key, salt);

  const moodsByPhase = {
    period: ['tired', 'calm', 'emotional', 'lowEnergy'],
    follicular: ['energetic', 'happy', 'calm'],
    ovulation: ['happy', 'energetic', 'frisky'],
    luteal: late
      ? ['irritable', 'anxious', 'moodSwings', 'emotional']
      : ['calm', 'neutral', 'tired'],
  };
  const mood = pick(moodsByPhase[phase], key, 'mood');
  const moods =
    r('mood2') < 0.35 ? [...new Set([mood, pick(moodsByPhase[phase], key, 'mood3')])] : [mood];

  const symptoms = [];
  if (phase === 'period') {
    if (cycleDay <= 2 || r('cramp') < 0.4) symptoms.push('cramps');
    if (r('back') < 0.35) symptoms.push('backache');
    if (r('fat') < 0.4) symptoms.push('fatigue');
    if (cycleDay === 2 && r('clot') < 0.3) symptoms.push('blood-clots');
  } else if (late) {
    if (r('tb') < 0.55) symptoms.push('tender-breasts');
    if (r('crave') < 0.5) symptoms.push('cravings');
    if (r('acne') < 0.3) symptoms.push('acne');
    if (r('head') < 0.25) symptoms.push('headache');
  } else if (phase === 'ovulation' && r('ov') < 0.5) {
    symptoms.push('ovulation-test-positive');
  } else if (r('fine') < 0.3) {
    symptoms.push('everything-is-fine');
  }

  const exerciseDay = r('ex') < 0.5;
  const temperature =
    Math.round(((phase === 'luteal' ? 36.68 : 36.38) + (r('bbt') - 0.5) * 0.16) * 100) / 100;

  return {
    userId,
    date: new Date(`${key}T00:00:00.000Z`),
    dateKey: key,
    flow: phase === 'period' ? FLOW[Math.min(cycleDay - 1, FLOW.length - 1)] : 'none',
    mood,
    moods,
    energy:
      phase === 'period'
        ? 'low'
        : phase === 'luteal' && late
          ? pick(['low', 'medium'], key, 'en')
          : pick(['steady', 'high', 'medium'], key, 'en'),
    symptoms,
    cycleDay,
    phase,
    sleepHours: Math.round((6.2 + r('sleep') * 2.3) * 2) / 2,
    waterIntake: Math.round((1500 + r('water') * 1300) / 100) * 100,
    stressLevel: Math.max(1, Math.min(10, Math.round(3 + r('stress') * 3 + (late ? 2 : 0)))),
    temperature,
    discharge:
      phase === 'period'
        ? undefined
        : phase === 'ovulation'
          ? pick(['egg-white', 'watery'], key, 'dc')
          : phase === 'follicular'
            ? pick(['sticky', 'creamy'], key, 'dc')
            : pick(['creamy', 'sticky', 'none'], key, 'dc'),
    digestions: late && r('bloat') < 0.4 ? ['bloated'] : r('dig') < 0.2 ? ['normal'] : [],
    skins: late && r('skin') < 0.35 ? ['acne'] : r('skin2') < 0.25 ? ['clear'] : [],
    exercise: exerciseDay
      ? [pick(['yoga', 'running', 'gym', 'cycling', 'aerobics-dancing'], key, 'exk')]
      : [],
  };
};

/** Day logs for the `days` days before today, skipping days already logged. */
const buildDemoLogs = async (userId, today, days) => {
  const fromKey = shiftDateKey(today, -days);
  const [settings, existing] = await Promise.all([
    CycleSettings.findOne({ userId }).lean(),
    CycleLog.find({ userId, dateKey: { $gte: fromKey, $lt: today } }, { dateKey: 1 }).lean(),
  ]);
  const taken = new Set(existing.map((l) => l.dateKey));
  const cycleLength = settings?.cycleLength || 28;
  const periodLength = Math.min(7, settings?.periodLength || 5);
  const lastStartKey = settings?.lastPeriodStartDate
    ? new Date(settings.lastPeriodStartDate).toISOString().slice(0, 10)
    : shiftDateKey(today, -10);
  const starts = periodStarts(lastStartKey > today ? today : lastStartKey, cycleLength, fromKey);

  const logs = [];
  for (let key = fromKey; key < today; key = shiftDateKey(key, 1)) {
    if (taken.has(key)) continue;
    const start = [...starts].reverse().find((s) => s <= key);
    if (!start) continue;
    const next = starts.find((s) => s > start);
    const thisLength = next ? keyDay(next) - keyDay(start) : cycleLength;
    const cycleDay = keyDay(key) - keyDay(start) + 1;
    logs.push(demoDayLog({ userId, key, cycleDay, cycleLength: thisLength, periodLength }));
  }
  return { logs, skipped: taken.size, settings: Boolean(settings), cycleLength, periodLength };
};

/* ------------------------- Community posts ------------------------- */

const DEMO_POSTS = [
  {
    category: 'question',
    title: 'Does anyone else get cramps before their period even starts?',
    content:
      'For the last few cycles I get cramps 2-3 days before any bleeding starts. Heat packs help a bit. Is this normal for you too, or should I bring it up with a doctor?',
    tags: ['cramps', 'pms'],
  },
  {
    category: 'advice',
    title: 'Small things that helped my period fatigue',
    content:
      'What worked for me: iron-rich food in the week before (spinach, dates, lentils), going to bed 30 minutes earlier, and a short walk in the morning instead of skipping exercise completely. Not a cure but I feel a lot less drained.',
    tags: ['fatigue', 'self-care'],
  },
  {
    category: 'PCOS',
    title: 'Six months into managing PCOS',
    content:
      'Diagnosed earlier this year. Tracking every day in the app made it much easier to show my doctor how irregular my cycles were. Cycles are slowly getting more regular with diet changes and strength training. Happy to answer questions!',
    tags: ['pcos', 'tracking'],
    isAnonymous: false,
  },
  {
    category: 'Fitness',
    title: 'Working out around your cycle',
    content:
      'I started planning heavier workouts in my follicular phase and lighter yoga or walks in the luteal phase and during my period. My energy matches the plan much better now. Anyone else cycle-sync their training?',
    tags: ['cycle-syncing', 'workout'],
  },
  {
    category: 'Skin',
    title: 'Hormonal breakouts along the jawline',
    content:
      'Every month, right before my period, I break out on my chin and jawline. A gentle cleanser and not touching my face helps a little. What has worked for you?',
    tags: ['acne', 'skincare'],
  },
  {
    category: 'success_story',
    title: 'Finally understood my cycle',
    content:
      'After a full year of logging, the predictions are spot on and I can see exactly when my mood dips. It feels so good to plan around it instead of being surprised every month.',
    tags: ['tracking', 'win'],
    isAnonymous: false,
  },
  {
    category: 'symptoms',
    title: 'Bloating in the luteal phase',
    content:
      'The week before my period I feel bloated almost every day. Cutting down on salty snacks and drinking more water helps. Peppermint tea is my new favourite.',
    tags: ['bloating', 'luteal'],
  },
  {
    category: 'rant',
    title: 'Why is nobody talking about period pain at work?',
    content:
      'Had to sit through a full day of meetings with terrible cramps and pretend everything was fine. We really need more understanding workplaces. Just needed to vent, thank you for listening.',
    tags: ['work', 'cramps'],
  },
  {
    category: 'general',
    title: 'Which period products do you prefer?',
    content:
      'Curious what everyone uses. I switched recently and would love to hear your experiences.',
    tags: ['products'],
    poll: {
      question: 'What do you use most?',
      allowMultiple: false,
      options: ['Pads', 'Tampons', 'Menstrual cup', 'Period underwear'],
    },
  },
  {
    category: 'advice',
    title: 'Sleep tips for the days before my period',
    content:
      'I sleep badly right before my period. Things that help: magnesium-rich foods at dinner, no screens 30 minutes before bed, and keeping the room cool. Sharing in case it helps someone!',
    tags: ['sleep', 'pms'],
  },
];

/** `count` sample posts, spread over the last few weeks (newest last). */
const buildDemoPosts = (userId, count) =>
  Array.from({ length: count }, (_, i) => {
    const { poll, isAnonymous = true, ...post } = DEMO_POSTS[i % DEMO_POSTS.length];
    const at = new Date(Date.now() - (count - i) * 2.5 * 24 * 3600 * 1000);
    at.setHours(9 + ((i * 5) % 12), (i * 17) % 60, 0, 0);
    return {
      ...post,
      userId,
      isAnonymous,
      ...(poll
        ? {
            poll: {
              ...poll,
              options: poll.options.map((topic, n) => ({
                optionId: `option_${n + 1}`,
                topic,
                votes: 0,
              })),
            },
          }
        : {}),
      createdAt: at,
      updatedAt: at,
    };
  });

/** The account's task days over all history, exactly as the forest counts them. */
const loadTaskDays = async (userId) => {
  const [cycleLogs, completions, waterings, habits] = await Promise.all([
    CycleLog.find({ userId }).lean(),
    HabitCompletion.find({ userId }, { dateKey: 1 }).lean(),
    ForestLog.find({ userId }, { dateKey: 1 }).lean(),
    Habit.find({ userId, isActive: true }, { completedDates: 1 }).lean(),
  ]);
  return buildTaskDays({
    logDates: cycleLogs.filter(hasCycleEntry).map((log) => log.dateKey),
    habitDates: [
      ...completions.map((c) => c.dateKey),
      ...habits.flatMap((h) => h.completedDates || []),
    ],
    waterDates: waterings.map((w) => w.dateKey),
  });
};

const main = async () => {
  if (!email || !Number.isFinite(trees) || trees < 0 || trees > 500) {
    console.error('Usage: --email <account email> [--trees 0-500] [--apply] [--remove]');
    process.exit(2);
  }
  await connectDB();
  const host = mongoose.connection.host;
  const user = await User.findOne({ email }).select('_id email isActive deletedAt').lean();
  if (!user) {
    console.error(`No account with email ${email} on ${host}.`);
    await disconnectDB();
    process.exit(1);
  }
  const userId = user._id;
  console.log(`Database: ${host}`);
  console.log(
    `Account:  ${user.email} (${userId})${apply ? '' : '  [DRY RUN: add --apply to write]'}`,
  );

  if (remove) {
    const habit = await Habit.findOne({ userId, title: DEMO_HABIT_TITLE }).select('_id').lean();
    const [logs, completions] = await Promise.all([
      ForestLog.countDocuments({ userId, note: DEMO_TAG }),
      habit ? HabitCompletion.countDocuments({ userId, habitId: habit._id }) : 0,
    ]);
    const manifest = readManifest(userId);
    const dayLogs = manifest.cycleLogIds.length
      ? await CycleLog.countDocuments({ userId, _id: { $in: manifest.cycleLogIds } })
      : 0;
    const posts = manifest.communityPostIds.length
      ? await CommunityPost.countDocuments({ userId, _id: { $in: manifest.communityPostIds } })
      : 0;
    console.log(
      `Would remove: ${logs} waterings, ${completions} habit completions, ${habit ? 1 : 0} habit, ${dayLogs} day logs, ${posts} community posts.`,
    );
    if (apply) {
      if (manifest.cycleLogIds.length) {
        await CycleLog.deleteMany({ userId, _id: { $in: manifest.cycleLogIds } });
      }
      if (manifest.communityPostIds.length) {
        await CommunityPost.deleteMany({ userId, _id: { $in: manifest.communityPostIds } });
      }
      writeManifest(userId, { cycleLogIds: [], communityPostIds: [] });
      await ForestLog.deleteMany({ userId, note: DEMO_TAG });
      if (habit) {
        await HabitCompletion.deleteMany({ userId, habitId: habit._id });
        await Habit.deleteOne({ _id: habit._id });
      }
      console.log('Removed.');
    }
    await disconnectDB();
    return;
  }

  // This machine's local date, like the app's "today" (not the server's UTC date).
  const now = new Date();
  const today = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((n, i) => String(n).padStart(i ? 2 : 4, '0'))
    .join('-');
  const taskDays = await loadTaskDays(userId);

  if (logDays > 0) {
    const { logs, skipped, settings, cycleLength, periodLength } = await buildDemoLogs(
      userId,
      today,
      logDays,
    );
    console.log(
      `Day logs: ${logs.length} to add over the last ${logDays} days (${skipped} already logged, kept), ` +
        `${settings ? 'following' : 'no cycle settings found, using'} a ${cycleLength}-day cycle, ${periodLength}-day period.`,
    );
    for (const log of logs) {
      if (!taskDays.has(log.dateKey)) taskDays.set(log.dateKey, new Set());
      taskDays.get(log.dateKey).add('log');
    }
    if (apply && logs.length) {
      const ids = [];
      for (let i = 0; i < logs.length; i += 500) {
        const saved = await CycleLog.insertMany(logs.slice(i, i + 500), { ordered: false });
        ids.push(...saved.map((d) => String(d._id)));
      }
      const manifest = readManifest(userId);
      writeManifest(userId, { ...manifest, cycleLogIds: [...manifest.cycleLogIds, ...ids] });
      console.log(`Saved ${ids.length} day logs (ids in ${manifestPath(userId)}).`);
    }
  }

  if (postCount > 0) {
    const posts = buildDemoPosts(userId, postCount);
    console.log(
      `Community: ${posts.length} posts to add (${posts[0].createdAt.toISOString().slice(0, 10)} → ${posts.at(-1).createdAt.toISOString().slice(0, 10)}).`,
    );
    if (apply) {
      const saved = await CommunityPost.insertMany(posts, { timestamps: false });
      const manifest = readManifest(userId);
      writeManifest(userId, {
        ...manifest,
        communityPostIds: [...manifest.communityPostIds, ...saved.map((d) => String(d._id))],
      });
      console.log(`Saved ${saved.length} community posts (ids in ${manifestPath(userId)}).`);
    }
  }

  const before = computeForestGrowth(taskDays, today);
  const target = trees * POINTS_PER_TREE + (POINTS_PER_TREE - 1);
  let need = target - before.totalPoints;
  console.log(
    `Now:      ${before.totalPoints} points (${before.treesGrown} trees, current at ${before.points}/${POINTS_PER_TREE}).`,
  );
  console.log(
    `Target:   ${target} points (${trees} trees, current at ${POINTS_PER_TREE - 1}/${POINTS_PER_TREE}).`,
  );
  if (need < 0) {
    // Past the target (e.g. the new day logs count too): drop the oldest demo
    // waterings/completions, which sit only on days with no real one of their own.
    const excess = -need;
    const [oldWater, oldHabit] = await Promise.all([
      ForestLog.find({ userId, note: DEMO_TAG }, { _id: 1, dateKey: 1 })
        .sort({ dateKey: 1 })
        .limit(excess)
        .lean(),
      HabitCompletion.find({ userId, note: DEMO_TAG }, { _id: 1, dateKey: 1 })
        .sort({ dateKey: 1 })
        .limit(excess)
        .lean(),
    ]);
    const oldest = [
      ...oldWater.map((r) => ({ ...r, kind: 'w' })),
      ...oldHabit.map((r) => ({ ...r, kind: 'h' })),
    ]
      .sort((a, b) => a.dateKey.localeCompare(b.dateKey))
      .slice(0, excess);
    console.log(
      `Over target by ${excess}: will remove the ${oldest.length} oldest demo waterings/completions.`,
    );
    if (apply) {
      await ForestLog.deleteMany({
        _id: { $in: oldest.filter((r) => r.kind === 'w').map((r) => r._id) },
      });
      await HabitCompletion.deleteMany({
        _id: { $in: oldest.filter((r) => r.kind === 'h').map((r) => r._id) },
      });
      const after = computeForestGrowth(await loadTaskDays(userId), today);
      console.log(
        `Done. Forest now: ${after.treesGrown} trees, current tree ${after.stage} at ${after.points}/${POINTS_PER_TREE}, ${after.vitality}.`,
      );
    }
    await disconnectDB();
    return;
  }
  if (need === 0) {
    console.log('Forest already on target.');
    await disconnectDB();
    return;
  }

  const habit = await Habit.findOne({ userId, title: DEMO_HABIT_TITLE }).lean();
  const habitId = habit?._id ?? new mongoose.Types.ObjectId();
  const waterings = [];
  const completions = [];
  const has = (key, task) => taskDays.get(key)?.has(task) ?? false;

  // Today: the habit only (keeps the tree "thriving"; water/log stay free to test).
  if (!has(today, 'habit')) {
    completions.push({ habitId, userId, dateKey: today, rewardPoints: 0, note: DEMO_TAG });
    need -= 1;
  }
  // Then back from yesterday: a watering and a habit completion on each day
  // that doesn't already have them, until the points add up.
  let key = shiftDateKey(today, -1);
  let oldest = today;
  while (need > 0) {
    if (!has(key, 'water')) {
      waterings.push({
        userId,
        dateKey: key,
        careType: 'water',
        note: DEMO_TAG,
        healthDelta: 0,
        rewardPoints: 0,
      });
      need -= 1;
    }
    if (need > 0 && !has(key, 'habit')) {
      completions.push({ habitId, userId, dateKey: key, rewardPoints: 0, note: DEMO_TAG });
      need -= 1;
    }
    oldest = key;
    key = shiftDateKey(key, -1);
  }

  console.log(
    `Will add: ${waterings.length} waterings + ${completions.length} habit completions (${oldest} → ${today})` +
      `${habit ? '' : ', and the habit "' + DEMO_HABIT_TITLE + '"'}.`,
  );
  if (!apply) {
    await disconnectDB();
    return;
  }

  if (!habit) {
    await Habit.create({
      _id: habitId,
      userId,
      title: DEMO_HABIT_TITLE,
      icon: 'leaf-outline',
      color: '#5DAA4E',
      rewardPoints: 1,
      isActive: true,
    });
  }
  for (let i = 0; i < waterings.length; i += 1000) {
    await ForestLog.insertMany(waterings.slice(i, i + 1000), { ordered: false });
  }
  for (let i = 0; i < completions.length; i += 1000) {
    await HabitCompletion.insertMany(completions.slice(i, i + 1000), { ordered: false });
  }

  const after = computeForestGrowth(await loadTaskDays(userId), today);
  console.log(
    `Done. Forest now: ${after.treesGrown} trees, current tree ${after.stage} at ${after.points}/${POINTS_PER_TREE}, ${after.vitality}.`,
  );
  console.log(
    'The app shows this only while the API has FOREST_FULL_HISTORY_EMAILS including this email (restart the API after setting it).',
  );
  await disconnectDB();
};

main().catch(async (error) => {
  console.error(error);
  await disconnectDB();
  process.exit(1);
});
