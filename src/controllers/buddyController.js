import crypto from 'crypto';
import BuddyMatch from '../models/BuddyMatch.js';
import CycleSettings from '../models/CycleSettings.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { computeCyclePredictions } from '../utils/cycle.js';
import { escapeRegex, isValidObjectId } from '../utils/apiHelpers.js';

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
  const alias = aliases[hashToIndex(candidate._id, aliases.length)];
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
      messages: [
        {
          sender: 'buddy',
          text: 'Hey period buddy. Our cycle windows look close this month. How are you feeling today?',
        },
      ],
    });

    await User.findByIdAndUpdate(req.userId, { $inc: { tokenEarned: 25 } });

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

    return sendResponse(res, HTTP_STATUS.OK, 'Buddy messages fetched', match.messages);
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

    match.messages.push({ sender: 'me', text: text.trim() });
    const reply = 'Totally. Let us check our habit updates later and compare how the day felt.';
    match.messages.push({ sender: 'buddy', text: reply });
    await match.save();
    await User.findByIdAndUpdate(req.userId, { $inc: { tokenEarned: 2 } });

    return sendResponse(res, HTTP_STATUS.OK, 'Buddy message sent', {
      messages: match.messages.slice(-2),
      tokensAwarded: 2,
    });
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

    return sendResponse(res, HTTP_STATUS.OK, 'Active buddy ended', match);
  } catch (error) {
    next(error);
  }
};
