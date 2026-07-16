import crypto from 'crypto';
import BuddyMatch from '../models/BuddyMatch.js';
import BuddyMessage from '../models/BuddyMessage.js';
import CycleSettings from '../models/CycleSettings.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { computeCyclePredictions } from '../utils/cycle.js';
import { escapeRegex, isValidObjectId } from '../utils/apiHelpers.js';
import { broadcastToRoom } from '../config/websocket.js';

const aliases = ['Mystic Peony', 'Cosmic Fern', 'Aura Amber', 'Lunar Sage', 'Velvet Iris', 'Bloom Nova'];

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
  },
];

const hashToIndex = (value, max) => Number.parseInt(crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8), 16) % max;

const getAvatarSeed = (name) => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();

const buildMatchFromUser = async (candidate, currentSettings) => {
  const settings = await CycleSettings.findOne({ userId: candidate._id });
  const alias = `${candidate.firstName} ${candidate.lastName}`;
  const candidatePredictions = settings ? computeCyclePredictions(settings) : null;
  const currentPredictions = currentSettings ? computeCyclePredictions(currentSettings) : null;
  const cycleDelta = settings && currentSettings ? Math.abs(settings.cycleLength - currentSettings.cycleLength) : 4;
  const samePhase = candidatePredictions?.currentPhase === currentPredictions?.currentPhase;
  const compatibility = Math.max(70, Math.min(98, 95 - cycleDelta * 2 + (samePhase ? 5 : 0)));

  return {
    id: String(candidate._id),
    alias,
    avatarSeed: getAvatarSeed(alias),
    cyclePhase: `${candidatePredictions?.currentPhase || 'Cycle'} Phase`,
    cycleOverlapDays: Math.max(0, 28 - cycleDelta),
    lastUpdate: candidate.lastLogin ? 'Recently active' : 'Updated this cycle',
    compatibility,
    similarities: [
      `${settings?.cycleLength || 28}-Day Cycle`,
      samePhase ? 'Similar Current Phase' : 'Nearby Cycle Pattern',
      'Private Wellness Tracking',
    ],
    isRealUser: true,
  };
};

const getCandidateByMatchId = async (matchId, userId) => {
  if (isValidObjectId(matchId)) {
    if (String(matchId) === String(userId)) return null;
    const candidate = await User.findOne({ _id: matchId, isActive: true });
    if (!candidate) return null;

    const currentSettings = await CycleSettings.findOne({ userId });
    return buildMatchFromUser(candidate, currentSettings);
  }

  return fallbackMatches.find((match) => match.id === matchId) || null;
};

export const getBuddyMatches = async (req, res, next) => {
  try {
    const { search } = req.query;
    const currentSettings = await CycleSettings.findOne({ userId: req.userId });
    const users = await User.find({
      _id: { $ne: req.userId },
      isActive: true,
      role: 'user',
    }).limit(10);

    let matches = await Promise.all(users.map((user) => buildMatchFromUser(user, currentSettings)));
    if (matches.length < 3) {
      matches = [...matches, ...fallbackMatches].slice(0, 6);
    }

    if (search) {
      const regex = new RegExp(escapeRegex(search), 'i');
      matches = matches.filter((match) =>
        regex.test(match.alias) || regex.test(match.cyclePhase) || match.similarities.some((item) => regex.test(item))
      );
    }

    matches.sort((a, b) => b.compatibility - a.compatibility);

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
    const match = await BuddyMatch.findOne({ userId: req.userId, status: 'active' }).sort({ createdAt: -1 });
    return sendResponse(res, HTTP_STATUS.OK, 'Active buddy fetched', match || null);
  } catch (error) {
    next(error);
  }
};

export const nominateBuddy = async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const active = await BuddyMatch.findOne({ userId: req.userId, status: 'active' });
    if (active) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'You already have an active Period Buddy for this cycle');
    }

    const candidate = await getCandidateByMatchId(matchId, req.userId);
    if (!candidate) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Buddy match not found');
    }

    const welcomeText = 'Hey period buddy. Our cycle windows look close this month. How are you feeling today?';

    const match = await BuddyMatch.create({
      userId: req.userId,
      buddyUserId: candidate.isRealUser ? candidate.id : null,
      matchKey: candidate.id,
      alias: candidate.alias,
      avatarSeed: candidate.avatarSeed,
      cyclePhase: candidate.cyclePhase,
      cycleOverlapDays: candidate.cycleOverlapDays,
      compatibility: candidate.compatibility,
      similarities: candidate.similarities,
      lastMessage: welcomeText,
      lastMessageAt: new Date(),
      unreadCount: 0,
      messages: [
        {
          sender: 'buddy',
          text: welcomeText,
        },
      ],
    });

    await BuddyMessage.create({
      matchId: match._id,
      sender: 'buddy',
      text: welcomeText,
    });

    // If it's a real user candidate, create the reciprocal active match for User B pointing back to User A
    if (candidate.isRealUser) {
      // 1. End any existing active buddy matches User B has
      await BuddyMatch.updateMany(
        { userId: candidate.id, status: 'active' },
        { status: 'ended', endedAt: new Date() }
      );

      // 2. Fetch User A's cycle settings to compute predictions and compatibility for User B
      const settingsA = await CycleSettings.findOne({ userId: req.userId });
      const settingsB = await CycleSettings.findOne({ userId: candidate.id });
      const predictionsA = settingsA ? computeCyclePredictions(settingsA) : null;
      const predictionsB = settingsB ? computeCyclePredictions(settingsB) : null;

      const cycleDelta = settingsA && settingsB ? Math.abs(settingsA.cycleLength - settingsB.cycleLength) : 4;
      const samePhase = predictionsA?.currentPhase === predictionsB?.currentPhase;
      const compatibility = Math.max(70, Math.min(98, 95 - cycleDelta * 2 + (samePhase ? 5 : 0)));
      const cycleOverlapDays = Math.max(0, 28 - cycleDelta);
      const cyclePhase = `${predictionsA?.currentPhase || 'Cycle'} Phase`;
      const similarities = [
        `${settingsA?.cycleLength || 28}-Day Cycle`,
        samePhase ? 'Similar Current Phase' : 'Nearby Cycle Pattern',
        'Private Wellness Tracking',
      ];

      const userA = await User.findById(req.userId);
      const aliasA = userA ? `${userA.firstName} ${userA.lastName}` : 'Period Buddy';

      const buddyMatch = await BuddyMatch.create({
        userId: candidate.id,
        buddyUserId: req.userId,
        matchKey: req.userId,
        alias: aliasA,
        avatarSeed: getAvatarSeed(aliasA),
        cyclePhase,
        cycleOverlapDays,
        compatibility,
        similarities,
        lastMessage: welcomeText,
        lastMessageAt: new Date(),
        unreadCount: 0,
        messages: [
          {
            sender: 'buddy',
            text: welcomeText,
          },
        ],
      });

      await BuddyMessage.create({
        matchId: buddyMatch._id,
        sender: 'buddy',
        text: welcomeText,
      });
    }

    await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 25 } });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Buddy nominated', {
      match,
      tokensAwarded: 25,
    });
  } catch (error) {
    next(error);
  }
};

export const getBuddyMessages = async (req, res, next) => {
  try {
    const match = await BuddyMatch.findOne({ userId: req.userId, status: 'active' });
    if (!match) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No active Period Buddy');

    const messages = await BuddyMessage.find({ matchId: match._id }).sort({ sentAt: 1 });

    if (messages.length === 0 && match.messages && match.messages.length > 0) {
      return sendResponse(res, HTTP_STATUS.OK, 'Buddy messages fetched', match.messages);
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Buddy messages fetched', messages);
  } catch (error) {
    next(error);
  }
};

export const sendBuddyMessage = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message text is required');
    if (text.trim().length > 1000) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message must be 1000 characters or fewer');

    const match = await BuddyMatch.findOne({ userId: req.userId, status: 'active' });
    if (!match) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No active Period Buddy');

    const userText = text.trim();

    // ──────────────────────────────────────────────────────────
    // Message Persistence (Sender)
    // ──────────────────────────────────────────────────────────
    match.messages.push({ sender: 'me', text: userText });
    match.lastMessage = userText;
    match.lastMessageAt = new Date();
    await match.save();

    const msgMe = await BuddyMessage.create({
      matchId: match._id,
      sender: 'me',
      text: userText,
    });

    await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 2 } });

    // ──────────────────────────────────────────────────────────
    // Reciprocal Message Persistence & Real-time Update (Receiver)
    // ──────────────────────────────────────────────────────────
    if (match.buddyUserId) {
      const buddyMatch = await BuddyMatch.findOne({ userId: match.buddyUserId, buddyUserId: req.userId, status: 'active' });
      if (buddyMatch) {
        buddyMatch.messages.push({ sender: 'buddy', text: userText });
        buddyMatch.lastMessage = userText;
        buddyMatch.lastMessageAt = new Date();
        buddyMatch.unreadCount = (buddyMatch.unreadCount || 0) + 1;
        await buddyMatch.save();

        const msgBuddy = await BuddyMessage.create({
          matchId: buddyMatch._id,
          sender: 'buddy',
          text: userText,
        });

        // Broadcast to receiver (User B) listening on `buddy_${req.userId}`
        broadcastToRoom(`buddy_${req.userId}`, {
          messages: [msgBuddy],
          tokensAwarded: 0,
        });
      }
    }

    const responseData = {
      messages: [msgMe],
      tokensAwarded: 2,
    };

    // Broadcast to sender (User A) listening on `buddy_${match.matchKey}`
    broadcastToRoom(`buddy_${match.matchKey}`, responseData);

    return sendResponse(res, HTTP_STATUS.OK, 'Buddy message sent', responseData);
  } catch (error) {
    next(error);
  }
};

export const endActiveBuddy = async (req, res, next) => {
  try {
    const match = await BuddyMatch.findOneAndUpdate(
      { userId: req.userId, status: 'active' },
      { status: 'ended', endedAt: new Date() },
      { new: true }
    );
    if (!match) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No active Period Buddy');

    if (match.buddyUserId) {
      // Also end reciprocal match for User B
      await BuddyMatch.findOneAndUpdate(
        { userId: match.buddyUserId, buddyUserId: req.userId, status: 'active' },
        { status: 'ended', endedAt: new Date() }
      );
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Active buddy ended', match);
  } catch (error) {
    next(error);
  }
};
