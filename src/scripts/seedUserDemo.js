/* eslint-disable no-console -- a CLI tool: its output is the point. */
/**
 * Fills ONE test account with demo data across the app's features, so every
 * screen has something to show. Pair it with seedForestDemo.js, which covers
 * day logs (calendar, predictions, reports), the Wellness Forest and
 * community posts.
 *
 *   node src/scripts/seedUserDemo.js --email you@example.com            (dry run)
 *   node src/scripts/seedUserDemo.js --email you@example.com --apply
 *   node src/scripts/seedUserDemo.js --email you@example.com --remove [--apply]
 *
 * Adds: notifications, habits (+ 30 days of completions), Nura AI chats,
 * support tickets (one answered), scheme applications, symptom-checker
 * results, check-in call history, a Bestie Circle with a vibe, reel likes /
 * saves / comments, and saved blogs. Skips consultations (payments and doctor
 * earnings), documents (files in S3) and partner/buddy links (need a second
 * real account).
 *
 * Every id it creates is kept in logs/user-demo-<userId>.json (git-ignored),
 * so --remove deletes exactly those rows and puts reel counters back. Running
 * --apply twice does nothing the second time; remove first to re-seed.
 * Notifications are inserted without the per-row push hook, so the phone
 * isn't buzzed ten times.
 */
import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import mongoose from 'mongoose';
import { connectDB, disconnectDB } from '../config/database.js';
import BestieCircle from '../models/BestieCircle.js';
import Blog from '../models/Blog.js';
import CheckinCall from '../models/CheckinCall.js';
import CircleVibe from '../models/CircleVibe.js';
import GovernmentBenefit from '../models/GovernmentBenefit.js';
import Habit from '../models/Habit.js';
import HabitCompletion from '../models/HabitCompletion.js';
import Notification from '../models/Notification.js';
import QaChatSession from '../models/QaChatSession.js';
import Reel from '../models/Reel.js';
import ReelComment from '../models/ReelComment.js';
import ReelLike from '../models/ReelLike.js';
import ReelSave from '../models/ReelSave.js';
import SchemeApplication from '../models/SchemeApplication.js';
import ScreeningAssessment from '../models/ScreeningAssessment.js';
import SupportTicket, { nextTicketNumber } from '../models/SupportTicket.js';
import User from '../models/User.js';
import { generateInviteCode } from '../utils/genz.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : undefined;
};
const apply = process.argv.includes('--apply');
const remove = process.argv.includes('--remove');
const email = String(arg('email') || '')
  .trim()
  .toLowerCase();

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n, hour = 10) => {
  const d = new Date(Date.now() - n * DAY);
  d.setHours(hour, 0, 0, 0);
  return d;
};
const dateKey = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const manifestPath = (userId) => path.resolve('logs', `user-demo-${userId}.json`);
const readManifest = (userId) => {
  try {
    return JSON.parse(fs.readFileSync(manifestPath(userId), 'utf8'));
  } catch {
    return null;
  }
};
const writeManifest = (userId, manifest) => {
  fs.mkdirSync(path.dirname(manifestPath(userId)), { recursive: true });
  fs.writeFileSync(manifestPath(userId), JSON.stringify(manifest, null, 2));
};

/* ------------------------------ builders ------------------------------ */

const notificationDocs = (userId) =>
  [
    [
      'period_reminder',
      'Period expected in 2 days',
      'Keep pads handy and log when it starts.',
      0,
      false,
    ],
    [
      'ovulation_reminder',
      'Fertile window starts tomorrow',
      'Your estimated ovulation is in 3 days.',
      1,
      false,
    ],
    [
      'habit_reminder',
      'Time for your evening stretch',
      'A 10-minute stretch helps with cramps.',
      1,
      true,
    ],
    ['reward_earned', 'You earned 10 points', 'Thanks for logging 7 days in a row.', 2, true],
    ['streak_bonus', '7-day streak!', 'You logged every day this week. Keep it up.', 3, true],
    [
      'community_reply',
      'New reply on your post',
      'Someone replied to "Cramps on day 1"',
      4,
      false,
      { route: '/community' },
    ],
    [
      'consultation_update',
      'Your consultation is confirmed',
      'Dr. Demo will see you on Friday at 5 PM.',
      6,
      true,
    ],
    [
      'system',
      'Log today',
      'How are you feeling today? Tap to log.',
      0,
      false,
      { kind: 'daily_nudge' },
    ],
    [
      'system',
      'New in Nura: Cycle Wrapped',
      'See your month in a story.',
      9,
      true,
      { route: '/wrapped' },
    ],
  ].map(([type, title, body, ago, isRead, data]) => ({
    userId,
    type,
    title,
    body,
    data: { ...(data || {}), demo: true },
    isRead,
    readAt: isRead ? daysAgo(ago, 20) : null,
    createdAt: daysAgo(ago, 9),
    updatedAt: daysAgo(ago, 9),
  }));

const HABITS = [
  { title: 'Drink 8 glasses of water', icon: 'water-outline', color: '#4FA3E0', rate: 0.8 },
  { title: 'Evening stretch (10 min)', icon: 'body-outline', color: '#7BC67E', rate: 0.6 },
  { title: 'Sleep by 11 PM', icon: 'moon-outline', color: '#9B8AE6', rate: 0.5 },
];

const qaSessions = (userId) => [
  {
    userId,
    topicId: 'cycle',
    topicLabel: 'Periods & Cycle',
    title: 'Is a 34-day cycle normal?',
    lastMessageAt: daysAgo(2, 21),
    createdAt: daysAgo(2, 21),
    messages: [
      { role: 'user', text: 'Is a 34-day cycle normal?' },
      {
        role: 'assistant',
        text: 'Cycles between 21 and 35 days are considered typical for adults, so 34 days can be normal, especially if it is similar most months. If it suddenly changes or varies by more than 7–9 days, it is worth mentioning to a gynaecologist.',
      },
      { role: 'user', text: 'Mine was 28 last month though.' },
      {
        role: 'assistant',
        text: 'A one-off longer cycle is common. Stress, travel, illness or sleep changes can delay ovulation. Keep logging; if it keeps happening, a doctor can check things like thyroid or PCOS.',
      },
    ],
  },
  {
    userId,
    topicId: 'symptoms',
    topicLabel: 'Symptoms & Pain',
    title: 'What helps with day-1 cramps?',
    lastMessageAt: daysAgo(10, 8),
    createdAt: daysAgo(10, 8),
    messages: [
      { role: 'user', text: 'What helps with day-1 cramps?' },
      {
        role: 'assistant',
        text: 'Heat on the lower belly, gentle movement like walking or yoga, staying hydrated and an over-the-counter pain reliever (if it suits you) all help. Pain that stops you from daily activities is worth discussing with a doctor.',
      },
    ],
  },
];

const supportTickets = async (userId) => {
  const first = await nextTicketNumber();
  const second = await nextTicketNumber();
  return [
    {
      userId,
      ticketNumber: first,
      category: 'period_tracking',
      subject: 'Prediction looks off by a few days',
      message: 'My period came 3 days earlier than predicted. Is that expected? (demo ticket)',
      status: 'resolved',
      lastReplyFrom: 'admin',
      userUnread: true,
      resolvedAt: daysAgo(4, 15),
      lastActivityAt: daysAgo(4, 15),
      replies: [
        {
          from: 'admin',
          message:
            'Thanks for writing in! Predictions get more accurate as you log more cycles, usually after 3. Keep logging and it will adjust.',
          createdAt: daysAgo(4, 15),
        },
      ],
      createdAt: daysAgo(5, 11),
    },
    {
      userId,
      ticketNumber: second,
      category: 'bug',
      subject: 'Reels take long to load on mobile data',
      message: 'Videos sometimes buffer for a while before playing. (demo ticket)',
      status: 'open',
      lastActivityAt: daysAgo(1, 18),
      createdAt: daysAgo(1, 18),
    },
  ];
};

const screenings = (userId) => [
  {
    userId,
    condition: 'pcos',
    answers: {
      pcos_irregular_cycles: 2,
      pcos_missed_periods: 1,
      pcos_hirsutism: 0,
      pcos_acne: 1,
      pcos_weight_change: 0,
      pcos_hair_thinning: 0,
      pcos_family_history: 0,
      pcos_skin_darkening: 0,
    },
    score: 28,
    riskLevel: 'low',
    summary: 'Your answers suggest a low likelihood of PCOS symptoms right now. (demo)',
    doctorDiscussionSummary:
      'Occasional irregular cycles and mild acne. No excess hair growth or weight change.',
    createdAt: daysAgo(20),
  },
  {
    userId,
    condition: 'thyroid',
    answers: {
      thyroid_fatigue: 2,
      thyroid_weight_change: 1,
      thyroid_cycle_changes: 2,
      thyroid_temperature_sensitivity: 2,
      thyroid_hair_skin_changes: 1,
      thyroid_mood_changes: 2,
      thyroid_neck_swelling: 0,
      thyroid_family_history: 1,
    },
    score: 52,
    riskLevel: 'moderate',
    summary:
      'Some symptoms overlap with thyroid conditions. A simple blood test can rule this out. (demo)',
    doctorDiscussionSummary: 'Frequent tiredness, occasional cold intolerance, mild hair thinning.',
    createdAt: daysAgo(7),
  },
];

const checkinCalls = (userId) => [
  {
    userId,
    source: 'scheduled',
    dateKey: dateKey(daysAgo(3)),
    attemptNumber: 1,
    status: 'connected',
    outcome: 'completed',
    durationSeconds: 142,
    summary: 'Light flow, mild cramps, mood okay. Logged flow and symptoms. (demo)',
    loggedFields: ['flow', 'symptoms', 'mood'],
    endedAt: daysAgo(3, 19),
    createdAt: daysAgo(3, 19),
  },
  {
    userId,
    source: 'scheduled',
    dateKey: dateKey(daysAgo(2)),
    attemptNumber: 1,
    status: 'no_answer',
    outcome: 'no_answer',
    createdAt: daysAgo(2, 19),
  },
  {
    userId,
    source: 'retry',
    dateKey: dateKey(daysAgo(2)),
    attemptNumber: 2,
    status: 'connected',
    outcome: 'completed',
    durationSeconds: 96,
    summary: 'Medium flow, slept 7 hours, drank enough water. (demo)',
    loggedFields: ['flow', 'sleepHours', 'waterIntake'],
    endedAt: daysAgo(2, 20),
    createdAt: daysAgo(2, 20),
  },
];

const REEL_COMMENTS = [
  'This was so helpful, thank you! (demo)',
  'Can you make one on PMS next? (demo)',
];

/* -------------------------------- main -------------------------------- */

const seed = async (user) => {
  const userId = user._id;
  const m = {
    userId: String(userId),
    notificationIds: [],
    habitIds: [],
    habitCompletionIds: [],
    qaSessionIds: [],
    supportTicketIds: [],
    schemeApplicationIds: [],
    screeningIds: [],
    checkinCallIds: [],
    circleIds: [],
    vibeIds: [],
    reelLikeReelIds: [],
    reelSaveReelIds: [],
    reelCommentIds: [],
    savedBlogIds: [],
  };

  const [reels, schemes, blogs, alreadySaved] = await Promise.all([
    Reel.find({ isActive: true }).sort({ publishedAt: -1 }).limit(4).select('_id title').lean(),
    GovernmentBenefit.find({ isActive: { $ne: false } })
      .limit(2)
      .select('_id name title')
      .lean(),
    Blog.find({ $or: [{ isPublished: true }, { status: 'published' }] })
      .sort({ publishedAt: -1 })
      .limit(3)
      .select('_id title')
      .lean(),
    User.findById(userId).select('savedBlogs').lean(),
  ]);

  console.log(`- ${notificationDocs(userId).length} notifications`);
  console.log(`- ${HABITS.length} habits with 30 days of completions`);
  console.log(
    `- ${qaSessions(userId).length} Nura AI chats, 2 support tickets, 2 symptom-checker results, 3 check-in calls`,
  );
  console.log(`- ${schemes.length} scheme applications, 1 Bestie Circle + vibe`);
  console.log(
    `- reels: like ${Math.min(3, reels.length)}, save ${Math.min(2, reels.length)}, comment on ${Math.min(2, reels.length)}`,
  );
  console.log(`- ${blogs.length} saved blogs`);
  if (!apply) return;

  // Written as we go, so a failure halfway can still be removed.
  const save = () => writeManifest(userId, m);

  const notes = await Notification.insertMany(notificationDocs(userId));
  m.notificationIds = notes.map((n) => String(n._id));
  save();

  for (const [index, h] of HABITS.entries()) {
    const habit = await Habit.create({
      userId,
      title: h.title,
      icon: h.icon,
      color: h.color,
      frequency: 'daily',
      reminderTime: '21:00',
    });
    m.habitIds.push(String(habit._id));
    const completions = [];
    for (let d = 1; d <= 30; d += 1) {
      // Deterministic pattern so re-seeding looks the same.
      if (((d * 7 + index * 3) % 10) / 10 < h.rate) {
        completions.push({
          habitId: habit._id,
          userId,
          dateKey: dateKey(daysAgo(d)),
          rewardPoints: 30,
        });
      }
    }
    const rows = await HabitCompletion.insertMany(completions, { ordered: false }).catch(
      (err) => err.insertedDocs || [],
    );
    m.habitCompletionIds.push(...rows.map((r) => String(r._id)));
    save();
  }

  for (const doc of qaSessions(userId))
    m.qaSessionIds.push(String((await QaChatSession.create(doc))._id));
  save();
  for (const doc of await supportTickets(userId))
    m.supportTicketIds.push(String((await SupportTicket.create(doc))._id));
  save();
  for (const doc of screenings(userId))
    m.screeningIds.push(String((await ScreeningAssessment.create(doc))._id));
  save();
  for (const doc of checkinCalls(userId))
    m.checkinCallIds.push(String((await CheckinCall.create(doc))._id));
  save();

  for (const [index, scheme] of schemes.entries()) {
    const app = await SchemeApplication.create({
      userId,
      schemeId: scheme._id,
      schemeName: scheme.name || scheme.title,
      status: index === 0 ? 'in_review' : 'submitted',
      formData: {
        fullName: user.firstName || 'Demo',
        state: 'Rajasthan',
        note: 'demo application',
      },
      createdAt: daysAgo(12 - index * 5),
    });
    m.schemeApplicationIds.push(String(app._id));
  }
  save();

  const circle = await BestieCircle.create({
    name: 'Demo Besties',
    ownerId: userId,
    inviteCode: generateInviteCode(),
    members: [{ userId, joinedAt: daysAgo(6) }],
  });
  m.circleIds.push(String(circle._id));
  const vibe = await CircleVibe.create({
    circleId: circle._id,
    userId,
    emoji: '🌸',
    text: 'Cramps today but chocolate helps (demo)',
  });
  m.vibeIds.push(String(vibe._id));
  save();

  for (const reel of reels.slice(0, 3)) {
    const res = await ReelLike.updateOne(
      { reelId: reel._id, userId },
      { $setOnInsert: { reelId: reel._id, userId } },
      { upsert: true },
    );
    if (res.upsertedCount) {
      await Reel.updateOne({ _id: reel._id }, { $inc: { likeCount: 1 } });
      m.reelLikeReelIds.push(String(reel._id));
    }
  }
  for (const reel of reels.slice(0, 2)) {
    const res = await ReelSave.updateOne(
      { reelId: reel._id, userId },
      { $setOnInsert: { reelId: reel._id, userId } },
      { upsert: true },
    );
    if (res.upsertedCount) {
      await Reel.updateOne({ _id: reel._id }, { $inc: { saveCount: 1 } });
      m.reelSaveReelIds.push(String(reel._id));
    }
  }
  for (const [index, reel] of reels.slice(0, 2).entries()) {
    const comment = await ReelComment.create({
      reelId: reel._id,
      userId,
      text: REEL_COMMENTS[index],
    });
    await Reel.updateOne({ _id: reel._id }, { $inc: { commentCount: 1 } });
    m.reelCommentIds.push(String(comment._id));
  }
  save();

  const have = new Set((alreadySaved?.savedBlogs || []).map(String));
  const toSave = blogs.map((b) => String(b._id)).filter((id) => !have.has(id));
  if (toSave.length)
    await User.updateOne({ _id: userId }, { $addToSet: { savedBlogs: { $each: toSave } } });
  m.savedBlogIds = toSave;
  save();
};

const unseed = async (userId, m) => {
  // Scoped to this account too, so a stale manifest can never delete someone else's rows.
  const del = async (Model, ids, owner = 'userId') =>
    ids?.length ? (await Model.deleteMany({ _id: { $in: ids }, [owner]: userId })).deletedCount : 0;
  const counts = {
    notifications: await del(Notification, m.notificationIds),
    habitCompletions: await del(HabitCompletion, m.habitCompletionIds),
    habits: await del(Habit, m.habitIds),
    qaSessions: await del(QaChatSession, m.qaSessionIds),
    supportTickets: await del(SupportTicket, m.supportTicketIds),
    schemeApplications: await del(SchemeApplication, m.schemeApplicationIds),
    screenings: await del(ScreeningAssessment, m.screeningIds),
    checkinCalls: await del(CheckinCall, m.checkinCallIds),
    vibes: await del(CircleVibe, m.vibeIds),
    circles: await del(BestieCircle, m.circleIds, 'ownerId'),
  };
  for (const reelId of m.reelLikeReelIds || []) {
    const res = await ReelLike.deleteOne({ reelId, userId });
    if (res.deletedCount)
      await Reel.updateOne({ _id: reelId, likeCount: { $gt: 0 } }, { $inc: { likeCount: -1 } });
  }
  for (const reelId of m.reelSaveReelIds || []) {
    const res = await ReelSave.deleteOne({ reelId, userId });
    if (res.deletedCount)
      await Reel.updateOne({ _id: reelId, saveCount: { $gt: 0 } }, { $inc: { saveCount: -1 } });
  }
  const comments = m.reelCommentIds?.length
    ? await ReelComment.find({ _id: { $in: m.reelCommentIds } })
        .select('reelId isHidden')
        .lean()
    : [];
  for (const c of comments) {
    await ReelComment.deleteOne({ _id: c._id });
    if (!c.isHidden)
      await Reel.updateOne(
        { _id: c.reelId, commentCount: { $gt: 0 } },
        { $inc: { commentCount: -1 } },
      );
  }
  if (m.savedBlogIds?.length)
    await User.updateOne(
      { _id: userId },
      { $pullAll: { savedBlogs: m.savedBlogIds.map((id) => new mongoose.Types.ObjectId(id)) } },
    );
  counts.reelLikes = m.reelLikeReelIds?.length || 0;
  counts.reelSaves = m.reelSaveReelIds?.length || 0;
  counts.reelComments = comments.length;
  counts.savedBlogs = m.savedBlogIds?.length || 0;
  return counts;
};

const main = async () => {
  if (!email) {
    console.error('Usage: --email <account email> [--apply] [--remove]');
    process.exit(2);
  }
  await connectDB();
  try {
    const user = await User.findOne({ email })
      .select('_id email firstName isActive deletedAt')
      .lean();
    if (!user) {
      console.error(`No account with email ${email} on ${mongoose.connection.host}.`);
      process.exitCode = 1;
      return;
    }
    console.log(
      `${apply ? 'Applying' : 'Dry run (add --apply to write)'} on ${mongoose.connection.host} for ${user.email}`,
    );
    const manifest = readManifest(user._id);

    if (remove) {
      if (!manifest) {
        console.log('No demo data recorded for this account.');
        return;
      }
      console.log('Removing the demo data in', manifestPath(user._id));
      if (!apply) return;
      console.log(await unseed(user._id, manifest));
      fs.rmSync(manifestPath(user._id), { force: true });
      return;
    }

    if (manifest) {
      console.log('Demo data already seeded for this account (remove it first to re-seed).');
      return;
    }
    await seed(user);
    if (apply) console.log('Done. Ids kept in', manifestPath(user._id));
  } finally {
    await disconnectDB();
  }
};

await main();
