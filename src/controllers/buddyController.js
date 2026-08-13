import crypto from 'crypto';
import BuddyMatch from '../models/BuddyMatch.js';
import BuddyMessage from '../models/BuddyMessage.js';
import CycleSettings from '../models/CycleSettings.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { escapeRegex, isValidObjectId } from '../utils/apiHelpers.js';
import { scoreBuddyCompatibility } from '../utils/buddyMatching.js';
import { broadcastToRoom } from '../config/websocket.js';

/**
 * Buddy pairing — one canonical BuddyMatch document per pairing (see the model).
 * The per-user "buddy card" is projected from live data at read time so both
 * sides always see fresh names/phases and there's no divergent second copy.
 *
 * Discovery candidates (the "matches" list) are never persisted — a BuddyMatch
 * row only exists once two real users are actually paired. Demo/fallback cards
 * exist purely to keep the discovery list from looking empty on a fresh install.
 */

const fallbackMatches = [
  {
    id: 'demo_mystic_peony',
    alias: 'Mystic Peony',
    avatarSeed: 'MP',
    cyclePhase: 'Ovulation Phase',
    cycleOverlapDays: 26,
    lastUpdate: 'Updated today',
    compatibility: 95,
    similarities: ['28-Day Cycle', 'PMDD Fatigue', 'Craves Dark Chocolate'],
    isRealUser: false,
  },
  {
    id: 'demo_cosmic_fern',
    alias: 'Cosmic Fern',
    avatarSeed: 'CF',
    cyclePhase: 'Luteal Phase',
    cycleOverlapDays: 22,
    lastUpdate: 'Updated today',
    compatibility: 88,
    similarities: ['31-Day Cycle', 'Insomnia Spikes', 'Hot Yoga Routine'],
    isRealUser: false,
  },
  {
    id: 'demo_aura_amber',
    alias: 'Aura Amber',
    avatarSeed: 'AA',
    cyclePhase: 'Follicular Phase',
    cycleOverlapDays: 19,
    lastUpdate: 'Updated 2 days ago',
    compatibility: 85,
    similarities: ['26-Day Cycle', 'Anxiety Spikes', 'Chamomile Tea Log'],
    isRealUser: false,
  },
];

const getAvatarSeed = (name) =>
  (name || '')
    .split(/\s+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join('')
    .slice(0, 2)
    .toUpperCase() || 'PB';

const fullName = (user) =>
  (user ? `${user.firstName || ''} ${user.lastName || ''}`.trim() : '') || 'Period Buddy';

/** Stable sorted member pair so a pairing maps to exactly one document. */
const memberPair = (a, b) => [String(a), String(b)].sort();

/** Deterministic unique key for a pair — matches BuddyMatch.pairKey. */
const pairKeyOf = (a, b) => memberPair(a, b).join('_');

/**
 * Builds the discovery card for a candidate user, scored against the viewer.
 * Not persisted — this is the shape the matches list and nominate resolution use.
 */
const buildCandidateCard = (candidate, candidateSettings, viewerSettings) => {
  const alias = fullName(candidate);
  const score = scoreBuddyCompatibility(viewerSettings, candidateSettings, {
    aLastActive: viewerSettings?.updatedAt,
    bLastActive: candidateSettings?.updatedAt ?? candidate.lastLogin,
  });

  return {
    id: String(candidate._id),
    alias,
    avatarSeed: getAvatarSeed(alias),
    cyclePhase: score.candidatePhaseLabel,
    cycleOverlapDays: score.cycleOverlapDays,
    lastUpdate: candidate.lastLogin ? 'Recently active' : 'Updated this cycle',
    compatibility: score.compatibility,
    similarities: score.similarities,
    isRealUser: true,
  };
};

/**
 * Projects a persisted pairing into the buddy card the requester should see:
 * the *counterpart's* name/avatar/phase, a freshly scored compatibility, and
 * the requester's own unread count. Keeps the API response shape identical to
 * the old per-user document so the app needs no contract change.
 */
const projectMatchForUser = async (match, requesterId) => {
  const otherId = match.members.find((m) => String(m) !== String(requesterId));

  const [otherUser, otherSettings, viewerSettings] = await Promise.all([
    User.findById(otherId).select('firstName lastName lastLogin'),
    CycleSettings.findOne({ userId: otherId }),
    CycleSettings.findOne({ userId: requesterId }),
  ]);

  const alias = fullName(otherUser);
  const score = scoreBuddyCompatibility(viewerSettings, otherSettings, {
    aLastActive: viewerSettings?.updatedAt,
    bLastActive: otherSettings?.updatedAt ?? otherUser?.lastLogin,
  });

  const read = match.reads?.find((r) => String(r.userId) === String(requesterId));
  const unreadCount = await BuddyMessage.countDocuments({
    matchId: match._id,
    senderId: { $ne: requesterId },
    sentAt: { $gt: read?.lastReadAt || new Date(0) },
  });

  return {
    _id: String(match._id),
    id: String(otherId),
    buddyUserId: String(otherId),
    matchKey: String(otherId),
    roomKey: match.roomKey,
    status: match.status,
    alias,
    avatarSeed: getAvatarSeed(alias),
    cyclePhase: score.candidatePhaseLabel,
    compatibility: match.compatibility ?? score.compatibility,
    cycleOverlapDays: match.cycleOverlapDays ?? score.cycleOverlapDays,
    similarities: match.similarities?.length ? match.similarities : score.similarities,
    lastMessage: match.lastMessage,
    lastMessageAt: match.lastMessageAt,
    unreadCount,
    nominatedAt: match.nominatedAt,
  };
};

/** Maps a stored message to the viewer-relative shape the app expects. */
const projectMessage = (msg, requesterId) => ({
  _id: String(msg._id),
  id: String(msg._id),
  sender: String(msg.senderId) === String(requesterId) ? 'me' : 'buddy',
  text: msg.text,
  sentAt: msg.sentAt,
});

// How many raw candidates to pull before scoring. Bounded so this endpoint is
// O(pool) — never a function of the total number of pairings in the system.
const CANDIDATE_POOL = 60;
const MATCHES_RETURNED = 10;

export const getBuddyMatches = async (req, res, next) => {
  try {
    const { search } = req.query;
    const viewerSettings = await CycleSettings.findOne({ userId: req.userId });

    // Pull a bounded pool of active users (indexed on isActive), excluding self.
    // Not filtered by `role` — a 'partner'-role account (a viewer of someone
    // else's cycle) can still track their own cycle and is a valid buddy.
    const pool = await User.find({ _id: { $ne: req.userId }, isActive: true })
      .select('firstName lastName lastLogin')
      .limit(CANDIDATE_POOL);
    const poolIds = pool.map((u) => u._id);

    // Drop anyone in the pool who's already paired — bounded by the pool size
    // via `$in`, not by scanning every pairing in the collection.
    const busyDocs = await BuddyMatch.find({ members: { $in: poolIds }, status: 'active' })
      .select('members')
      .lean();
    const busy = new Set();
    for (const doc of busyDocs) for (const m of doc.members) busy.add(String(m));

    const available = pool.filter((u) => !busy.has(String(u._id)));

    const settingsById = new Map(
      (await CycleSettings.find({ userId: { $in: available.map((u) => u._id) } })).map((s) => [
        String(s.userId),
        s,
      ]),
    );

    let matches = available.map((user) =>
      buildCandidateCard(user, settingsById.get(String(user._id)), viewerSettings),
    );

    // Best cycle fit first; this is the actual match ranking.
    matches.sort((a, b) => b.compatibility - a.compatibility);
    matches = matches.slice(0, MATCHES_RETURNED);

    // Keep the list from looking empty on a fresh install / tiny user base.
    if (matches.length < 3) {
      matches = [...matches, ...fallbackMatches].slice(0, 6);
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      matches = matches.filter(
        (match) =>
          regex.test(match.alias) ||
          regex.test(match.cyclePhase) ||
          match.similarities.some((item) => regex.test(item)),
      );
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Buddy matches fetched', {
      matches,
      activeLimit: 1,
    });
  } catch (error) {
    next(error);
  }
};

export const getActiveBuddy = async (req, res, next) => {
  try {
    const match = await BuddyMatch.findOne({ members: req.userId, status: 'active' }).sort({
      createdAt: -1,
    });
    if (!match) return sendResponse(res, HTTP_STATUS.OK, 'Active buddy fetched', null);

    const card = await projectMatchForUser(match, req.userId);
    return sendResponse(res, HTTP_STATUS.OK, 'Active buddy fetched', card);
  } catch (error) {
    next(error);
  }
};

export const nominateBuddy = async (req, res, next) => {
  try {
    const { matchId } = req.params;

    // One buddy at a time.
    const active = await BuddyMatch.findOne({ members: req.userId, status: 'active' });
    if (active) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'You already have an active Period Buddy for this cycle',
      );
    }

    // Only real users can be paired — demo cards are display-only.
    if (!isValidObjectId(matchId) || String(matchId) === String(req.userId)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'Pick a real Period Buddy from your matches to connect',
      );
    }

    const candidate = await User.findOne({ _id: matchId, isActive: true }).select(
      'firstName lastName lastLogin',
    );
    if (!candidate) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Buddy match not found');
    }

    // Don't stomp someone who's already paired — consent-safe by construction.
    const candidateBusy = await BuddyMatch.findOne({ members: candidate._id, status: 'active' });
    if (candidateBusy) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'This buddy just connected with someone else — try another match',
      );
    }

    const [viewerSettings, candidateSettings] = await Promise.all([
      CycleSettings.findOne({ userId: req.userId }),
      CycleSettings.findOne({ userId: candidate._id }),
    ]);
    const score = scoreBuddyCompatibility(viewerSettings, candidateSettings, {
      aLastActive: viewerSettings?.updatedAt,
      bLastActive: candidateSettings?.updatedAt ?? candidate.lastLogin,
    });

    const members = memberPair(req.userId, candidate._id);
    const roomKey = crypto.randomUUID();
    const welcomeText =
      'Hey period buddy. Our cycle windows look close this month. How are you feeling today?';

    let match;
    try {
      match = await BuddyMatch.create({
        members,
        pairKey: pairKeyOf(req.userId, candidate._id),
        roomKey,
        compatibility: score.compatibility,
        cycleOverlapDays: score.cycleOverlapDays,
        similarities: score.similarities,
        lastMessage: welcomeText,
        lastMessageAt: new Date(),
        nominatedBy: req.userId,
        nominatedAt: new Date(),
        reads: [
          // The initiator has "seen" the welcome; the counterpart hasn't.
          { userId: req.userId, lastReadAt: new Date() },
          { userId: candidate._id, lastReadAt: null },
        ],
      });
    } catch (err) {
      // Unique index race: the pair got created by a concurrent request.
      if (err?.code === 11000) {
        return sendError(
          res,
          HTTP_STATUS.CONFLICT,
          'This buddy just connected with someone else — try another match',
        );
      }
      throw err;
    }

    // Seed the welcome as a real message authored by the counterpart.
    await BuddyMessage.create({
      matchId: match._id,
      senderId: candidate._id,
      text: welcomeText,
    });

    await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 25 } });

    // Let the counterpart's app know in real time so the pairing appears
    // without a manual refresh.
    broadcastToRoom(`user_${candidate._id}`, { type: 'buddy_matched' });

    const card = await projectMatchForUser(match, req.userId);
    return sendResponse(res, HTTP_STATUS.CREATED, 'Buddy nominated', {
      match: card,
      tokensAwarded: 25,
    });
  } catch (error) {
    next(error);
  }
};

export const getBuddyMessages = async (req, res, next) => {
  try {
    const match = await BuddyMatch.findOne({ members: req.userId, status: 'active' });
    if (!match) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No active Period Buddy');

    // Newest-first for the cap, then restored to chronological order. Older
    // history would need a paginated "load earlier" call.
    const docs = (
      await BuddyMessage.find({ matchId: match._id }).sort({ sentAt: -1 }).limit(300)
    ).reverse();

    // Opening the chat marks everything read for this member.
    await BuddyMatch.updateOne(
      { _id: match._id, 'reads.userId': req.userId },
      { $set: { 'reads.$.lastReadAt': new Date() } },
    );

    const messages = docs.map((m) => projectMessage(m, req.userId));
    return sendResponse(res, HTTP_STATUS.OK, 'Buddy messages fetched', messages);
  } catch (error) {
    next(error);
  }
};

export const sendBuddyMessage = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message text is required');
    if (text.trim().length > 1000)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message must be 1000 characters or fewer');

    const match = await BuddyMatch.findOne({ members: req.userId, status: 'active' });
    if (!match) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No active Period Buddy');

    const userText = text.trim();
    const now = new Date();

    // One write to the shared stream.
    const msg = await BuddyMessage.create({
      matchId: match._id,
      senderId: req.userId,
      text: userText,
      sentAt: now,
    });

    match.lastMessage = userText;
    match.lastMessageAt = now;
    // Sending counts as reading your own thread up to now.
    const myRead = match.reads.find((r) => String(r.userId) === String(req.userId));
    if (myRead) myRead.lastReadAt = now;
    else match.reads.push({ userId: req.userId, lastReadAt: now });
    await match.save();

    await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 2 } });

    const otherId = match.members.find((m) => String(m) !== String(req.userId));

    // Broadcast to each side on their personal room, with the sender mapped
    // relative to that recipient (absolute senderId, projected per-viewer).
    if (otherId) {
      broadcastToRoom(`user_${otherId}`, {
        messages: [projectMessage(msg, otherId)],
        tokensAwarded: 0,
      });
    }
    broadcastToRoom(`user_${req.userId}`, {
      messages: [projectMessage(msg, req.userId)],
      tokensAwarded: 2,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Buddy message sent', {
      messages: [projectMessage(msg, req.userId)],
      tokensAwarded: 2,
    });
  } catch (error) {
    next(error);
  }
};

export const endActiveBuddy = async (req, res, next) => {
  try {
    const match = await BuddyMatch.findOne({ members: req.userId, status: 'active' });
    if (!match) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No active Period Buddy');

    const otherId = match.members.find((m) => String(m) !== String(req.userId));

    // Exiting a buddy space deletes it and its whole message history — the space
    // is private and disposable by design, so nothing is left behind for either
    // side to stumble back into.
    await BuddyMessage.deleteMany({ matchId: match._id });
    await BuddyMatch.deleteOne({ _id: match._id });

    // Tell the counterpart in real time on their personal room (not the shared
    // buddy_<roomKey> room, which would also reach the leaver's own socket and
    // show them a confusing "your buddy left" about their own action).
    if (otherId) {
      broadcastToRoom(`user_${otherId}`, { type: 'buddy_ended' });
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Active buddy ended', { ended: true });
  } catch (error) {
    next(error);
  }
};
