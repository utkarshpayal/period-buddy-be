import Reel from '../models/Reel.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
  pickDefined,
} from '../utils/apiHelpers.js';

const serializeReel = (reel, userId) => {
  const object = reel.toObject ? reel.toObject() : reel;
  const vote = object.votes?.find((item) => String(item.userId) === String(userId));

  return {
    ...object,
    id: object._id,
    followedByMe: object.followedBy?.some((id) => String(id) === String(userId)) || false,
    votedOptionId: vote?.optionId || null,
    votes: undefined,
    followedBy: undefined,
  };
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
      Reel.find(filter).sort({ publishedAt: -1, createdAt: -1 }).skip(skip).limit(limit),
      Reel.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Reels fetched', {
      reels: reels.map((reel) => serializeReel(reel, req.userId)),
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

    const reel = await Reel.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $inc: { viewCount: 1 } },
      { new: true },
    );
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Reel fetched', serializeReel(reel, req.userId));
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
    ]);

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

    const reel = await Reel.findOne({ _id: req.params.id, isActive: true });
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    const alreadyFollowing = reel.followedBy.some((id) => String(id) === String(req.userId));
    if (alreadyFollowing) {
      reel.followedBy = reel.followedBy.filter((id) => String(id) !== String(req.userId));
    } else {
      reel.followedBy.push(req.userId);
      await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 2 } });
    }

    await reel.save();

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

    const reel = await Reel.findOne({ _id: req.params.id, isActive: true });
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    if (reel.votes.some((vote) => String(vote.userId) === String(req.userId))) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'You have already voted on this reel');
    }

    const option = reel.pollOptions.find((item) => item.optionId === optionId);
    if (!option) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid poll option');

    option.votes += 1;
    reel.votes.push({ userId: req.userId, optionId });
    await reel.save();
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
