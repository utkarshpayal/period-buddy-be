/**
 * One-time migration: collapse the old two-row-per-pairing buddy model into the
 * new single canonical BuddyMatch document with one shared BuddyMessage stream.
 *
 *   OLD: two BuddyMatch rows (userId + buddyUserId) per pairing, and every
 *        message stored twice (sender "me" on one row, "buddy" on the other).
 *   NEW: one BuddyMatch row (members: [a, b]) per pairing, and every message
 *        stored once with an absolute senderId.
 *
 * Run once, after deploying the new models/controller:
 *   node src/scripts/migrateBuddyPairs.js
 *
 * It is idempotent — if the data is already in the new shape it exits without
 * touching anything. It rewrites the `buddymatches` and `buddymessages`
 * collections wholesale, so BACK UP THE DATABASE FIRST.
 */
/* eslint-disable no-console -- this is a CLI migration script; console output is the UX */
import 'dotenv/config';
import mongoose from 'mongoose';
import crypto from 'crypto';
import { connectDB, disconnectDB } from '../config/database.js';
import BuddyMatch from '../models/BuddyMatch.js';
import BuddyMessage from '../models/BuddyMessage.js';

const { ObjectId } = mongoose.Types;

// Two messages are treated as the same logical message (the duplicated me/buddy
// pair) when they share sender + text and were written within this window.
const DEDUPE_WINDOW_MS = 10_000;

// Drop stale indexes from the old schema (e.g. the old
// userId_1_matchKey_1_status_1 unique index). Leftover indexes on now-absent
// fields would index new docs as all-null and reject the second pairing. The
// new indexes are (re)built separately, only once clean data is in place.
const dropStaleIndexes = async (matchesCol) => {
  try {
    await matchesCol.dropIndexes();
    console.log('Dropped stale buddymatches indexes.');
  } catch (err) {
    console.warn('Could not drop buddymatches indexes (continuing):', err.message);
  }
};

const buildCurrentIndexes = async () => {
  await BuddyMatch.syncIndexes();
  await BuddyMessage.syncIndexes();
};

const run = async () => {
  await connectDB();
  const db = mongoose.connection.db;
  const matchesCol = db.collection('buddymatches');
  const messagesCol = db.collection('buddymessages');

  const oldMatches = await matchesCol.find({}).toArray();
  const looksOld = oldMatches.some((m) => m.userId !== undefined);

  if (!looksOld) {
    // No data to transform — but still reconcile indexes, because the old
    // schema's stale unique index (userId_1_matchKey_1_status_1) survives on the
    // collection even with zero old-shape docs and would index new docs as
    // all-null, rejecting the second pairing. This makes the script safe to run
    // on a fresh deploy too.
    console.log(`No old-shape buddy data (${oldMatches.length} doc(s)); reconciling indexes only.`);
    await dropStaleIndexes(matchesCol);
    await buildCurrentIndexes();
    console.log('Buddy pairing migration complete.');
    await disconnectDB();
    return;
  }

  const oldMessages = await messagesCol.find({}).toArray();

  // oldMatchId -> { owner, other, roomKey } so we can resolve each old message's
  // absolute author before we discard the per-user rows.
  const infoByOldId = new Map();
  for (const m of oldMatches) {
    infoByOldId.set(String(m._id), {
      owner: m.userId ? String(m.userId) : null,
      other: m.buddyUserId ? String(m.buddyUserId) : null,
      roomKey: m.roomKey || null,
    });
  }

  // Group by the unordered real-member pair so A–B is one pairing regardless of
  // how many stale rows or roomKeys the old data had.
  const groups = new Map();
  for (const m of oldMatches) {
    const members = [m.userId, m.buddyUserId].filter(Boolean).map(String);
    if (members.length !== 2) continue; // solo/demo rows can't become a pairing
    const key = [...members].sort().join('_');
    if (!groups.has(key)) {
      groups.set(key, {
        members: [...members].sort(),
        roomKey: null,
        status: 'ended',
        rows: [],
      });
    }
    const g = groups.get(key);
    g.rows.push(m);
    if (m.roomKey && !g.roomKey) g.roomKey = m.roomKey;
    if (m.status === 'active') g.status = 'active';
  }

  const now = new Date();
  const newMatches = [];
  const newIdByGroupKey = new Map();
  const newIdByRoomKey = new Map();

  for (const [key, g] of groups) {
    const _id = new ObjectId();
    newIdByGroupKey.set(key, _id);

    // Prefer the freshest row's summary/metadata.
    const primary = g.rows
      .slice()
      .sort(
        (a, b) =>
          new Date(b.lastMessageAt || b.updatedAt || 0) -
          new Date(a.lastMessageAt || a.updatedAt || 0),
      )[0];

    const roomKey = g.roomKey || crypto.randomUUID();
    for (const row of g.rows) if (row.roomKey) newIdByRoomKey.set(String(row.roomKey), _id);
    newIdByRoomKey.set(roomKey, _id);

    newMatches.push({
      _id,
      members: g.members.map((id) => new ObjectId(id)),
      pairKey: g.members.join('_'),
      roomKey,
      status: g.status,
      compatibility: primary?.compatibility ?? 80,
      cycleOverlapDays: primary?.cycleOverlapDays ?? 0,
      similarities: primary?.similarities ?? [],
      lastMessage: primary?.lastMessage,
      lastMessageAt: primary?.lastMessageAt,
      // Mark both members caught up so migration doesn't invent unread badges.
      reads: g.members.map((id) => ({ userId: new ObjectId(id), lastReadAt: now })),
      nominatedBy: primary?.userId ? new ObjectId(String(primary.userId)) : undefined,
      nominatedAt: primary?.nominatedAt || primary?.createdAt || now,
      createdAt: primary?.createdAt || now,
      updatedAt: now,
    });
  }

  // Rebuild the message stream, resolving absolute senderId and de-duplicating
  // the old me/buddy pair.
  const seen = new Set();
  const newMessages = [];
  for (const msg of oldMessages) {
    const info = infoByOldId.get(String(msg.matchId));
    if (!info || !info.owner || !info.other) continue; // orphan / solo message

    const senderId = msg.sender === 'me' ? info.owner : info.other;
    const canonicalId =
      (info.roomKey && newIdByRoomKey.get(String(info.roomKey))) ||
      newIdByGroupKey.get([info.owner, info.other].sort().join('_'));
    if (!canonicalId) continue;

    const bucket = Math.floor(
      new Date(msg.sentAt || msg.createdAt || 0).getTime() / DEDUPE_WINDOW_MS,
    );
    const dedupeKey = `${canonicalId}|${senderId}|${msg.text}|${bucket}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    newMessages.push({
      _id: new ObjectId(),
      matchId: canonicalId,
      senderId: new ObjectId(senderId),
      text: msg.text,
      sentAt: msg.sentAt || msg.createdAt || now,
      createdAt: msg.createdAt || now,
      updatedAt: now,
    });
  }

  console.log(
    `Migrating: ${oldMatches.length} old match rows -> ${newMatches.length} pairings; ` +
      `${oldMessages.length} old messages -> ${newMessages.length} messages.`,
  );

  // Drop stale indexes first, then swap the data, then build the new unique
  // indexes on the clean rows (building them while old pairKey-less docs still
  // existed would fail on the all-null unique key).
  await dropStaleIndexes(matchesCol);

  await matchesCol.deleteMany({});
  if (newMatches.length) await matchesCol.insertMany(newMatches);

  await messagesCol.deleteMany({});
  if (newMessages.length) await messagesCol.insertMany(newMessages);

  await buildCurrentIndexes();

  console.log('Buddy pairing migration complete.');
  await disconnectDB();
};

run().catch(async (err) => {
  console.error('Buddy pairing migration failed:', err);
  await disconnectDB();
  process.exit(1);
});
