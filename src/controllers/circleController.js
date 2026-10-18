import BestieCircle from '../models/BestieCircle.js';
import CircleVibe from '../models/CircleVibe.js';
import CycleSettings from '../models/CycleSettings.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { isValidObjectId, clientToday } from '../utils/apiHelpers.js';
import { computeCyclePredictions } from '../utils/cycle.js';
import { loadPredictionLogs } from '../utils/predictionLogs.js';
import {
  CIRCLE_LIMITS,
  CIRCLE_REACTIONS,
  generateInviteCode,
  normalizeInviteCode,
  parseCircleInput,
  parseVibeInput,
} from '../utils/genz.js';
import { PHASE_ERAS } from '../constants/cycleSync.js';
import { removeFromCircle } from '../utils/circleMembership.js';
import logger from '../utils/logger.js';

const FEED_LIMIT = 50;
const circleRoute = (id) => `/circles?id=${id}`;
const isMember = (circle, userId) =>
  circle.members.some((m) => String(m.userId) === String(userId));

/** Create with a fresh invite code, retrying the rare unique-index collision. */
const createWithUniqueCode = async (doc, attempts = 5) => {
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await BestieCircle.create({ ...doc, inviteCode: generateInviteCode() });
    } catch (error) {
      if (error?.code !== 11000 || i === attempts - 1) throw error;
    }
  }
  return null;
};

/** Loads the circle and 404s unless the caller is in it (never leaks existence). */
const loadMemberCircle = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    sendError(res, HTTP_STATUS.NOT_FOUND, 'Circle not found');
    return null;
  }
  const circle = await BestieCircle.findById(req.params.id);
  if (!circle || !isMember(circle, req.userId)) {
    sendError(res, HTTP_STATUS.NOT_FOUND, 'Circle not found');
    return null;
  }
  return circle;
};

const publicVibe = (v, userId) => ({
  id: String(v._id),
  userId: String(v.userId),
  emoji: v.emoji,
  text: v.text,
  phase: v.phase,
  phaseEmoji: v.phase ? PHASE_ERAS[v.phase].statusEmoji : null,
  askForSupport: v.askForSupport,
  reactions: CIRCLE_REACTIONS.map((emoji) => {
    const who = v.reactions.filter((r) => r.emoji === emoji);
    return { emoji, count: who.length, mine: who.some((r) => String(r.userId) === String(userId)) };
  }).filter((r) => r.count > 0),
  isMine: String(v.userId) === String(userId),
  createdAt: v.createdAt,
});

const summary = (circle, userId, latestVibe = null) => ({
  id: String(circle._id),
  name: circle.name,
  emoji: circle.emoji,
  memberCount: circle.members.length,
  isOwner: String(circle.ownerId) === String(userId),
  latestVibe,
  updatedAt: circle.updatedAt,
});

/** GET /api/circles — the caller's circles, most recently active first. */
export const listCircles = async (req, res, next) => {
  try {
    const circles = await BestieCircle.find({ 'members.userId': req.userId }).lean();
    const latest = await CircleVibe.aggregate([
      { $match: { circleId: { $in: circles.map((c) => c._id) } } },
      { $sort: { createdAt: -1 } },
      { $group: { _id: '$circleId', vibe: { $first: '$$ROOT' } } },
    ]);
    const latestById = new Map(latest.map((l) => [String(l._id), l.vibe]));
    const posters = await User.find({ _id: { $in: latest.map((l) => l.vibe.userId) } })
      .select('firstName')
      .lean();
    const nameById = new Map(posters.map((u) => [String(u._id), u.firstName]));

    const rows = circles
      .map((c) => {
        const v = latestById.get(String(c._id));
        return summary(
          c,
          req.userId,
          v
            ? {
                emoji: v.emoji,
                text: v.text,
                name: nameById.get(String(v.userId)) || 'Someone',
                createdAt: v.createdAt,
              }
            : null,
        );
      })
      .sort(
        (a, b) =>
          new Date(b.latestVibe?.createdAt ?? b.updatedAt) -
          new Date(a.latestVibe?.createdAt ?? a.updatedAt),
      );

    return sendResponse(res, HTTP_STATUS.OK, 'Circles fetched', {
      circles: rows,
      limits: CIRCLE_LIMITS,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/circles — body { name, emoji? } */
export const createCircle = async (req, res, next) => {
  try {
    const parsed = parseCircleInput(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const count = await BestieCircle.countDocuments({ 'members.userId': req.userId });
    if (count >= CIRCLE_LIMITS.maxCirclesPerUser) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        `You can be in up to ${CIRCLE_LIMITS.maxCirclesPerUser} circles`,
      );
    }
    const circle = await createWithUniqueCode({
      ...parsed.circle,
      ownerId: req.userId,
      members: [{ userId: req.userId }],
    });
    logger.info('circle_created', {
      action: 'circle_created',
      userId: req.userId,
      circleId: String(circle._id),
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Circle created', {
      circle: { ...summary(circle, req.userId), inviteCode: circle.inviteCode },
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/circles/join — body { code } */
export const joinCircle = async (req, res, next) => {
  try {
    const code = normalizeInviteCode(req.body?.code);
    if (code.length !== 6)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Enter the 6-character code');
    const circle = await BestieCircle.findOne({ inviteCode: code });
    if (!circle) return sendError(res, HTTP_STATUS.NOT_FOUND, "That code doesn't match a circle");
    if (isMember(circle, req.userId)) {
      return sendResponse(res, HTTP_STATUS.OK, 'Already in this circle', {
        circle: summary(circle, req.userId),
        alreadyMember: true,
      });
    }
    const count = await BestieCircle.countDocuments({ 'members.userId': req.userId });
    if (count >= CIRCLE_LIMITS.maxCirclesPerUser) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        `You can be in up to ${CIRCLE_LIMITS.maxCirclesPerUser} circles`,
      );
    }
    // Atomic size check so two people joining at once can't overshoot the cap.
    const updated = await BestieCircle.findOneAndUpdate(
      {
        _id: circle._id,
        'members.userId': { $ne: req.userId },
        [`members.${CIRCLE_LIMITS.maxMembers - 1}`]: { $exists: false },
      },
      { $push: { members: { userId: req.userId, joinedAt: new Date() } } },
      { new: true },
    );
    if (!updated) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        `This circle is full (${CIRCLE_LIMITS.maxMembers} max)`,
      );
    }

    const joiner = await User.findById(req.userId).select('firstName').lean();
    await Promise.all(
      updated.members
        .filter((m) => String(m.userId) !== String(req.userId))
        .map((m) =>
          Notification.create({
            userId: m.userId,
            type: 'system',
            title: `${updated.emoji} ${joiner?.firstName || 'Someone'} joined ${updated.name}`,
            body: 'Go say hi and drop a vibe ✨',
            data: {
              kind: 'circle_join',
              circleId: String(updated._id),
              route: circleRoute(updated._id),
            },
          }),
        ),
    );
    logger.info('circle_joined', {
      action: 'circle_joined',
      userId: req.userId,
      circleId: String(updated._id),
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Joined circle', {
      circle: summary(updated, req.userId),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/circles/:id — members with their latest vibe, plus the feed. */
export const getCircle = async (req, res, next) => {
  try {
    const circle = await loadMemberCircle(req, res);
    if (!circle) return undefined;
    const [users, vibes] = await Promise.all([
      User.find({ _id: { $in: circle.members.map((m) => m.userId) } })
        .select('firstName profilePicture')
        .lean(),
      CircleVibe.find({ circleId: circle._id }).sort({ createdAt: -1 }).limit(FEED_LIMIT).lean(),
    ]);
    const userById = new Map(users.map((u) => [String(u._id), u]));
    const feed = vibes.map((v) => publicVibe(v, req.userId));
    const latestByUser = new Map();
    feed.forEach((v) => !latestByUser.has(v.userId) && latestByUser.set(v.userId, v));

    const members = circle.members
      .map((m) => {
        const id = String(m.userId);
        const u = userById.get(id);
        return {
          userId: id,
          name: u?.firstName || 'Bestie',
          profilePicture: u?.profilePicture || null,
          isYou: id === String(req.userId),
          isOwner: id === String(circle.ownerId),
          joinedAt: m.joinedAt,
          vibe: latestByUser.get(id) || null,
        };
      })
      .sort((a, b) => Number(b.isYou) - Number(a.isYou));

    const nameOf = (id) => userById.get(id)?.firstName || 'Bestie';
    return sendResponse(res, HTTP_STATUS.OK, 'Circle fetched', {
      circle: {
        ...summary(circle, req.userId),
        inviteCode: circle.inviteCode,
        members,
        feed: feed.map((v) => ({ ...v, name: nameOf(v.userId) })),
      },
      reactions: CIRCLE_REACTIONS,
      limits: CIRCLE_LIMITS,
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/circles/:id — body { name, emoji } (owner only) */
export const updateCircle = async (req, res, next) => {
  try {
    const circle = await loadMemberCircle(req, res);
    if (!circle) return undefined;
    if (String(circle.ownerId) !== String(req.userId)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Only the circle owner can rename it');
    }
    const parsed = parseCircleInput(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    Object.assign(circle, parsed.circle);
    await circle.save();
    return sendResponse(res, HTTP_STATUS.OK, 'Circle saved', {
      circle: summary(circle, req.userId),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/circles/:id/invite-code — rotate the code (owner only). */
export const resetInviteCode = async (req, res, next) => {
  try {
    const circle = await loadMemberCircle(req, res);
    if (!circle) return undefined;
    if (String(circle.ownerId) !== String(req.userId)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Only the circle owner can reset the code');
    }
    for (let i = 0; i < 5; i += 1) {
      try {
        circle.inviteCode = generateInviteCode();
        await circle.save();
        break;
      } catch (error) {
        if (error?.code !== 11000 || i === 4) throw error;
      }
    }
    return sendResponse(res, HTTP_STATUS.OK, 'New code ready', { inviteCode: circle.inviteCode });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/circles/:id/members/:userId — leave ("me") or remove (owner). */
export const removeMember = async (req, res, next) => {
  try {
    const circle = await loadMemberCircle(req, res);
    if (!circle) return undefined;
    const target = req.params.userId === 'me' ? String(req.userId) : req.params.userId;
    const isSelf = target === String(req.userId);
    if (!isSelf && String(circle.ownerId) !== String(req.userId)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Only the circle owner can remove members');
    }
    if (!isMember(circle, target)) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Not a member');
    const result = await removeFromCircle(circle, target);
    return sendResponse(res, HTTP_STATUS.OK, isSelf ? 'Left circle' : 'Member removed', result);
  } catch (error) {
    next(error);
  }
};

/** The poster's current phase, or null if they have no cycle set up. */
const currentPhaseOf = async (userId, today) => {
  const settings = await CycleSettings.findOne({ userId }).lean();
  if (!settings) return null;
  const logs = await loadPredictionLogs(userId);
  return computeCyclePredictions(settings, logs, { today }).currentPhase ?? null;
};

/** POST /api/circles/:id/vibes — body { emoji, text?, sharePhase?, askForSupport? } */
export const postVibe = async (req, res, next) => {
  try {
    const circle = await loadMemberCircle(req, res);
    if (!circle) return undefined;
    const parsed = parseVibeInput(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const { sharePhase, ...fields } = parsed.vibe;
    const phase = sharePhase ? await currentPhaseOf(req.userId, clientToday(req)) : null;
    const vibe = await CircleVibe.create({
      ...fields,
      phase,
      circleId: circle._id,
      userId: req.userId,
    });
    await BestieCircle.updateOne({ _id: circle._id }, { $currentDate: { updatedAt: true } });

    // Only a "could use some love" vibe pings the others; plain status updates
    // stay quiet so a busy circle doesn't turn into notification spam.
    if (vibe.askForSupport) {
      const me = await User.findById(req.userId).select('firstName').lean();
      await Promise.all(
        circle.members
          .filter((m) => String(m.userId) !== String(req.userId))
          .map((m) =>
            Notification.create({
              userId: m.userId,
              type: 'system',
              title: `${vibe.emoji} ${me?.firstName || 'Your bestie'} could use some love`,
              body: vibe.text || `Send them a little hype in ${circle.name} 🫂`,
              data: {
                kind: 'circle_support',
                circleId: String(circle._id),
                route: circleRoute(circle._id),
              },
            }),
          ),
      );
    }
    return sendResponse(res, HTTP_STATUS.CREATED, 'Vibe posted', {
      vibe: publicVibe(vibe, req.userId),
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/circles/:id/vibes/:vibeId — your own vibe only. */
export const deleteVibe = async (req, res, next) => {
  try {
    const circle = await loadMemberCircle(req, res);
    if (!circle) return undefined;
    if (!isValidObjectId(req.params.vibeId))
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Vibe not found');
    const result = await CircleVibe.deleteOne({
      _id: req.params.vibeId,
      circleId: circle._id,
      userId: req.userId,
    });
    if (!result.deletedCount) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Vibe not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Vibe deleted', { id: req.params.vibeId });
  } catch (error) {
    next(error);
  }
};

/** POST /api/circles/:id/vibes/:vibeId/react — body { emoji }; toggles it. */
export const reactToVibe = async (req, res, next) => {
  try {
    const circle = await loadMemberCircle(req, res);
    if (!circle) return undefined;
    const emoji = req.body?.emoji;
    if (!CIRCLE_REACTIONS.includes(emoji))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Unknown reaction');
    if (!isValidObjectId(req.params.vibeId))
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Vibe not found');
    const filter = { _id: req.params.vibeId, circleId: circle._id };
    const existing = await CircleVibe.findOne({
      ...filter,
      reactions: { $elemMatch: { userId: req.userId, emoji } },
    }).select('_id');
    const vibe = await CircleVibe.findOneAndUpdate(
      filter,
      existing
        ? { $pull: { reactions: { userId: req.userId, emoji } } }
        : { $push: { reactions: { userId: req.userId, emoji } } },
      { new: true },
    ).lean();
    if (!vibe) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Vibe not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Reaction saved', {
      vibe: publicVibe(vibe, req.userId),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/circles/:id/hype/:userId — a push to one member, rate-limited. */
export const sendHype = async (req, res, next) => {
  try {
    const circle = await loadMemberCircle(req, res);
    if (!circle) return undefined;
    const target = req.params.userId;
    if (target === String(req.userId))
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        "You can't hype yourself (but you're doing great)",
      );
    if (!isValidObjectId(target) || !isMember(circle, target)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Not a member');
    }
    const recent = await Notification.exists({
      userId: target,
      'data.kind': 'circle_hype',
      'data.fromUserId': String(req.userId),
      createdAt: { $gte: new Date(Date.now() - CIRCLE_LIMITS.hypeCooldownMs) },
    });
    if (recent) {
      return sendError(
        res,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        'You already hyped them recently. Save some for later 🫶',
      );
    }
    const me = await User.findById(req.userId).select('firstName').lean();
    await Notification.create({
      userId: target,
      type: 'system',
      title: `${me?.firstName || 'Your bestie'} sent you hype 🫶`,
      body: `From ${circle.emoji} ${circle.name}. You've got this.`,
      data: {
        kind: 'circle_hype',
        circleId: String(circle._id),
        fromUserId: String(req.userId),
        route: circleRoute(circle._id),
      },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Hype sent', { sent: true });
  } catch (error) {
    next(error);
  }
};
