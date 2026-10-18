import mongoose from 'mongoose';
import Reel from '../models/Reel.js';
import ReelComment from '../models/ReelComment.js';
import ReelLike from '../models/ReelLike.js';
import ReelSave from '../models/ReelSave.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { PERMISSIONS, hasPermission } from '../config/permissions.js';
import { AUDIT_ACTIONS, recordAudit } from '../utils/auditLog.js';
import logger from '../utils/logger.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
  pickDefined,
} from '../utils/apiHelpers.js';
import {
  REEL_COMMENT_REPORT_HIDE_AT,
  buildCommentPage,
  normalizeCommentText,
  normalizeReelTags,
  orderBySaves,
  parseCommentCursor,
  parseCommentLimit,
  parseFlag,
  reelIdSet,
  serializeComment,
  withViewerState,
} from '../utils/reelSocial.js';

// The per-user vote/follow arrays grow with every interaction, so list and
// detail reads never load them (see loadReelViewerState).
const REEL_LIST_FIELDS = '-votes -followedBy';

const serializeReel = (reel, userId, viewer) => {
  const object = reel.toObject ? reel.toObject() : reel;
  const vote = viewer
    ? viewer.votes.get(String(object._id))
    : object.votes?.find((item) => String(item.userId) === String(userId));
  const followedByMe = viewer
    ? viewer.followedIds.has(String(object._id))
    : object.followedBy?.some((id) => String(id) === String(userId)) || false;

  return {
    ...object,
    id: object._id,
    followedByMe,
    votedOptionId: vote?.optionId || null,
    votes: undefined,
    followedBy: undefined,
  };
};

/**
 * The viewer's poll vote and creator follow for a page of reels: two `$in`
 * queries that return only the viewer's own entry, never the whole arrays.
 * Anonymous viewers have neither.
 */
const loadReelViewerState = async (ids, userId) => {
  const viewer = { votes: new Map(), followedIds: new Set() };
  if (!isValidObjectId(userId) || ids.length === 0) return viewer;
  const uid = new mongoose.Types.ObjectId(String(userId));
  const [voted, followedIds] = await Promise.all([
    Reel.find({ _id: { $in: ids }, 'votes.userId': uid })
      .select({ votes: { $elemMatch: { userId: uid } } })
      .lean(),
    Reel.find({ _id: { $in: ids }, followedBy: uid }).distinct('_id'),
  ]);
  voted.forEach((reel) => {
    if (reel.votes?.[0]) viewer.votes.set(String(reel._id), reel.votes[0]);
  });
  followedIds.forEach((id) => viewer.followedIds.add(String(id)));
  return viewer;
};

/**
 * Serialize a page of reels with the viewer's like/save/vote/follow state:
 * a fixed handful of `$in` queries for the whole page (never one per reel).
 * `reels` are loaded with REEL_LIST_FIELDS.
 */
const serializeReelsForViewer = async (reels, userId) => {
  if (reels.length === 0) return [];
  const ids = reels.map((reel) => reel._id);
  const viewerPromise = loadReelViewerState(ids, userId);
  const [likes, saves] = userId
    ? await Promise.all([
        ReelLike.find({ userId, reelId: { $in: ids } })
          .select('reelId')
          .lean(),
        ReelSave.find({ userId, reelId: { $in: ids } })
          .select('reelId')
          .lean(),
      ])
    : [[], []];
  const state = { likedIds: reelIdSet(likes), savedIds: reelIdSet(saves) };
  const viewer = await viewerPromise;
  return reels.map((reel) => withViewerState(serializeReel(reel, userId, viewer), state));
};

const PUBLIC_AUTHOR_FIELDS = 'firstName lastName profilePicture';

const canModerateComments = (req) => hasPermission(req.user?.role, PERMISSIONS.CONTENT_WRITE);

/** The active reel at `req.params.id` (lean), or null after answering 400/404. */
const findActiveReel = async (req, res, select = '_id') => {
  if (!isValidObjectId(req.params.id)) {
    sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    return null;
  }
  const reel = await Reel.findOne({ _id: req.params.id, isActive: true }).select(select).lean();
  if (!reel) sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');
  return reel;
};

/**
 * Idempotent set (not toggle) on a ReelLike/ReelSave row. The counter only
 * moves when this request really inserted or deleted the row, so double taps
 * and retries can't drift it. Returns the fresh counter.
 */
const setReelMark = async ({ Model, counter, reelId, userId, on }) => {
  let changed = false;
  if (on) {
    try {
      const result = await Model.updateOne(
        { reelId, userId },
        { $setOnInsert: { reelId, userId } },
        { upsert: true },
      );
      changed = result.upsertedCount > 0;
    } catch (error) {
      // Two requests raced on the unique index: the other one inserted it.
      if (error?.code !== 11000) throw error;
    }
    if (changed) await Reel.updateOne({ _id: reelId }, { $inc: { [counter]: 1 } });
  } else {
    const result = await Model.deleteOne({ reelId, userId });
    changed = result.deletedCount > 0;
    if (changed) {
      await Reel.updateOne({ _id: reelId, [counter]: { $gt: 0 } }, { $inc: { [counter]: -1 } });
    }
  }
  const fresh = await Reel.findById(reelId).select(counter).lean();
  return Math.max(0, fresh?.[counter] || 0);
};

export const getReels = async (req, res, next) => {
  try {
    const { category, search } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 10, maxLimit: 50 });

    const filter = { isActive: true };
    if (category && category !== 'all') filter.category = category;
    if (search) {
      filter.$or = [
        { title: { $regex: escapeRegex(search), $options: 'i' } },
        { creatorName: { $regex: escapeRegex(search), $options: 'i' } },
        { category: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    const [reels, total] = await Promise.all([
      Reel.find(filter)
        .sort({ publishedAt: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .select(REEL_LIST_FIELDS),
      Reel.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Reels fetched', {
      reels: await serializeReelsForViewer(reels, req.userId),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

export const getReelById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    // Reading a reel no longer counts a view: the app calls PATCH /:id/view
    // once the reel has actually played for a moment.
    const reel = await Reel.findOne({ _id: req.params.id, isActive: true }).select(
      REEL_LIST_FIELDS,
    );
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    const [serialized] = await serializeReelsForViewer([reel], req.userId);
    return sendResponse(res, HTTP_STATUS.OK, 'Reel fetched', serialized);
  } catch (error) {
    next(error);
  }
};

export const createReel = async (req, res, next) => {
  try {
    const {
      title,
      creatorId,
      creatorName,
      creatorAvatar,
      duration,
      category,
      verified,
      thumbnailUrl,
      directMp4Url,
      pollQuestion,
      pollOptions,
      description,
      tags,
    } = req.body;

    if (
      !title?.trim() ||
      !creatorId?.trim() ||
      !creatorName?.trim() ||
      !thumbnailUrl?.trim() ||
      !directMp4Url?.trim()
    ) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'title, creatorId, creatorName, thumbnailUrl, and directMp4Url are required',
      );
    }

    const options = Array.isArray(pollOptions)
      ? pollOptions
          .map((option, index) => ({
            optionId: option.optionId || `option_${index + 1}`,
            topic: option.topic,
            votes: Number(option.votes || 0),
          }))
          .filter((option) => option.topic)
      : [];

    const reel = await Reel.create({
      title: title.trim(),
      creatorId: creatorId.trim(),
      creatorName: creatorName.trim(),
      creatorAvatar,
      duration,
      category,
      verified,
      thumbnailUrl,
      directMp4Url,
      pollQuestion,
      pollOptions: options,
      description: typeof description === 'string' ? description.trim() : undefined,
      tags: normalizeReelTags(tags),
      publishedAt: new Date(),
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Reel created', reel);
  } catch (error) {
    next(error);
  }
};

export const updateReel = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    const updates = pickDefined(req.body, [
      'title',
      'creatorId',
      'creatorName',
      'creatorAvatar',
      'duration',
      'category',
      'verified',
      'thumbnailUrl',
      'directMp4Url',
      'pollQuestion',
      'pollOptions',
      'isActive',
      'publishedAt',
      'description',
      'tags',
    ]);
    if (updates.tags !== undefined) updates.tags = normalizeReelTags(updates.tags);

    const reel = await Reel.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Reel updated', reel);
  } catch (error) {
    next(error);
  }
};

export const deleteReel = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    const reel = await Reel.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Reel deleted');
  } catch (error) {
    next(error);
  }
};

export const recordView = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    const reel = await Reel.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $inc: { viewCount: 1 } },
      { new: true },
    );
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    return sendResponse(res, HTTP_STATUS.OK, 'View recorded', {
      views: reel.viewCount,
      viewCount: reel.viewCount,
    });
  } catch (error) {
    next(error);
  }
};

export const toggleFollowCreator = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    // Atomic $pull/$addToSet filtered on current membership, instead of
    // loading the whole followedBy array and saving it back (a lost update
    // when two people follow at once).
    const [reel, followingRow] = await Promise.all([
      Reel.findOne({ _id: req.params.id, isActive: true }).select('creatorId').lean(),
      Reel.exists({ _id: req.params.id, isActive: true, followedBy: req.userId }),
    ]);
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    const alreadyFollowing = Boolean(followingRow);
    if (alreadyFollowing) {
      await Reel.updateOne({ _id: reel._id }, { $pull: { followedBy: req.userId } });
    } else {
      const result = await Reel.updateOne(
        { _id: reel._id, followedBy: { $ne: req.userId } },
        { $addToSet: { followedBy: req.userId } },
      );
      // Only the request that really added the follow earns the tokens.
      if (result.modifiedCount > 0) {
        await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 2 } });
      }
    }

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      alreadyFollowing ? 'Creator unfollowed' : 'Creator followed',
      {
        followedByMe: !alreadyFollowing,
        creatorId: reel.creatorId,
      },
    );
  } catch (error) {
    next(error);
  }
};

export const votePoll = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    const { optionId } = req.body;
    if (!optionId?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'optionId is required');

    // One atomic update: the filter refuses a second vote by the same user
    // and an unknown option, so concurrent taps can't double-count.
    const uid = new mongoose.Types.ObjectId(String(req.userId));
    const reel = await Reel.findOneAndUpdate(
      {
        _id: req.params.id,
        isActive: true,
        'votes.userId': { $ne: uid },
        'pollOptions.optionId': optionId,
      },
      {
        $push: { votes: { userId: uid, optionId, votedAt: new Date() } },
        $inc: { 'pollOptions.$[option].votes': 1 },
      },
      {
        new: true,
        arrayFilters: [{ 'option.optionId': optionId }],
        projection: { pollOptions: 1 },
      },
    );

    if (!reel) {
      // Same checks, same order, as before: missing reel, already voted,
      // unknown option.
      const current = await Reel.findOne({ _id: req.params.id, isActive: true })
        .select({ _id: 1, votes: { $elemMatch: { userId: uid } } })
        .lean();
      if (!current) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');
      if (current.votes?.length) {
        return sendError(res, HTTP_STATUS.CONFLICT, 'You have already voted on this reel');
      }
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid poll option');
    }

    await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 5 } });

    return sendResponse(res, HTTP_STATUS.OK, 'Vote counted', {
      votedOptionId: optionId,
      pollOptions: reel.pollOptions,
      tokensAwarded: 5,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/reels/:id/like — body { liked: boolean }; sets, never toggles. */
export const setLike = async (req, res, next) => {
  try {
    const liked = parseFlag(req.body?.liked);
    if (liked === null)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'liked must be true or false');
    const reel = await findActiveReel(req, res);
    if (!reel) return undefined;

    const likeCount = await setReelMark({
      Model: ReelLike,
      counter: 'likeCount',
      reelId: reel._id,
      userId: req.userId,
      on: liked,
    });
    return sendResponse(res, HTTP_STATUS.OK, liked ? 'Reel liked' : 'Reel unliked', {
      liked,
      likeCount,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/reels/:id/save — body { saved: boolean }; sets, never toggles. */
export const setSave = async (req, res, next) => {
  try {
    const saved = parseFlag(req.body?.saved);
    if (saved === null)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'saved must be true or false');
    const reel = await findActiveReel(req, res);
    if (!reel) return undefined;

    const saveCount = await setReelMark({
      Model: ReelSave,
      counter: 'saveCount',
      reelId: reel._id,
      userId: req.userId,
      on: saved,
    });
    return sendResponse(res, HTTP_STATUS.OK, saved ? 'Reel saved' : 'Reel removed from saved', {
      saved,
      saveCount,
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/reels/saved?page=&limit= — the caller's saved reels, newest save first. */
export const getSavedReels = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 10, maxLimit: 50 });
    const [saveRows, total] = await Promise.all([
      ReelSave.find({ userId: req.userId })
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .select('reelId')
        .lean(),
      ReelSave.countDocuments({ userId: req.userId }),
    ]);
    const reels = await Reel.find({
      _id: { $in: saveRows.map((row) => row.reelId) },
      isActive: true,
    }).select(REEL_LIST_FIELDS);

    return sendResponse(res, HTTP_STATUS.OK, 'Saved reels fetched', {
      reels: await serializeReelsForViewer(orderBySaves(saveRows, reels), req.userId),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/reels/:id/comments?cursor=&limit= — newest first, cursor-paged.
 * `?moderation=1` from a content.write holder also returns hidden comments
 * with their report counts (admin portal).
 */
export const listComments = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }
    const moderation = req.query.moderation === '1' && canModerateComments(req);
    // Moderators can read comments on unpublished reels too.
    const reel = await Reel.findOne(
      moderation ? { _id: req.params.id } : { _id: req.params.id, isActive: true },
    )
      .select('commentCount')
      .lean();
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    const limit = parseCommentLimit(req.query.limit);
    const cursor = parseCommentCursor(req.query.cursor);
    const filter = { reelId: reel._id };
    if (!moderation) filter.isHidden = false;
    if (cursor) filter._id = { $lt: cursor };

    const rows = await ReelComment.find(filter)
      .sort({ _id: -1 })
      .limit(limit + 1)
      .populate('userId', PUBLIC_AUTHOR_FIELDS)
      .lean();
    const { items, nextCursor } = buildCommentPage(rows, limit);

    return sendResponse(res, HTTP_STATUS.OK, 'Comments fetched', {
      comments: items.map((row) =>
        serializeComment(row, { viewerId: req.userId, canModerate: moderation }),
      ),
      nextCursor,
      commentCount: Math.max(0, reel.commentCount || 0),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/reels/:id/comments — body { text } (≤ 500 chars). Rate-limited. */
export const addComment = async (req, res, next) => {
  try {
    const { text, error } = normalizeCommentText(req.body?.text);
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);
    const reel = await findActiveReel(req, res);
    if (!reel) return undefined;

    const [created, author] = await Promise.all([
      ReelComment.create({ reelId: reel._id, userId: req.userId, text }),
      User.findById(req.userId).select(PUBLIC_AUTHOR_FIELDS).lean(),
    ]);
    const updated = await Reel.findByIdAndUpdate(
      reel._id,
      { $inc: { commentCount: 1 } },
      { new: true },
    )
      .select('commentCount')
      .lean();

    logger.info('reel_comment_added', {
      action: 'reel_comment_added',
      userId: req.userId,
      reelId: String(reel._id),
      commentId: String(created._id),
    });

    const row = { ...created.toObject(), userId: author ?? created.userId };
    return sendResponse(res, HTTP_STATUS.CREATED, 'Comment added', {
      comment: serializeComment(row, { viewerId: req.userId }),
      commentCount: Math.max(0, updated?.commentCount || 0),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/reels/:id/comments/:commentId — the author, or staff with
 * content.write (admin moderation, audited). Works on unpublished reels too.
 */
export const deleteComment = async (req, res, next) => {
  try {
    const { id, commentId } = req.params;
    if (!isValidObjectId(id)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    if (!isValidObjectId(commentId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid comment id');
    }

    const comment = await ReelComment.findOne({ _id: commentId, reelId: id })
      .select('userId isHidden')
      .lean();
    if (!comment) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Comment not found');

    const isAuthor = String(comment.userId) === String(req.userId);
    const asModerator = !isAuthor && canModerateComments(req);
    if (!isAuthor && !asModerator) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You can only delete your own comments');
    }

    const removed = await ReelComment.findOneAndDelete({ _id: commentId, reelId: id })
      .select('isHidden')
      .lean();
    // Hidden comments were already taken off the count when they were hidden.
    if (removed && !removed.isHidden) {
      await Reel.updateOne({ _id: id, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });
    }
    const reel = await Reel.findById(id).select('commentCount').lean();

    if (asModerator) {
      await recordAudit({
        req,
        action: AUDIT_ACTIONS.REEL_COMMENT_DELETED,
        resourceType: 'reel_comment',
        resourceId: commentId,
        metadata: { reelId: id },
      });
    }
    logger.info('reel_comment_deleted', {
      action: 'reel_comment_deleted',
      userId: req.userId,
      reelId: id,
      commentId,
      asModerator,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Comment deleted', {
      commentCount: Math.max(0, reel?.commentCount || 0),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/reels/:id/comments/:commentId/report — once per person, not on
 * your own comment. At REEL_COMMENT_REPORT_HIDE_AT reports it's hidden for
 * everyone (moderators still see it in the admin portal).
 */
export const reportComment = async (req, res, next) => {
  try {
    const { id, commentId } = req.params;
    if (!isValidObjectId(id)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    if (!isValidObjectId(commentId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid comment id');
    }

    const comment = await ReelComment.findOne({ _id: commentId, reelId: id })
      .select('userId')
      .lean();
    if (!comment) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Comment not found');
    if (String(comment.userId) === String(req.userId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, "You can't report your own comment");
    }

    await ReelComment.updateOne(
      { _id: commentId, reportedBy: { $ne: req.userId } },
      { $addToSet: { reportedBy: req.userId }, $inc: { reportCount: 1 } },
    );
    // Hide exactly once (compare-and-set on isHidden), then fix the count.
    const hidden = await ReelComment.findOneAndUpdate(
      { _id: commentId, isHidden: false, reportCount: { $gte: REEL_COMMENT_REPORT_HIDE_AT } },
      { $set: { isHidden: true } },
      { new: true },
    )
      .select('_id')
      .lean();
    if (hidden) {
      await Reel.updateOne({ _id: id, commentCount: { $gt: 0 } }, { $inc: { commentCount: -1 } });
      logger.warn('reel_comment_auto_hidden', {
        action: 'reel_comment_auto_hidden',
        reelId: id,
        commentId,
      });
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Comment reported', { reported: true });
  } catch (error) {
    next(error);
  }
};
