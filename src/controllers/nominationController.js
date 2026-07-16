import Nomination from '../models/Nomination.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';

/** GET /api/nominations — Get user's sent nominations */
export const getMyNominations = async (req, res, next) => {
  try {
    const nominations = await Nomination.find({ nominatorId: req.userId })
      .populate('nomineeId', 'firstName lastName profilePicture')
      .sort({ createdAt: -1 });

    return sendResponse(res, HTTP_STATUS.OK, 'Nominations', nominations);
  } catch (error) {
    next(error);
  }
};

/** GET /api/nominations/incoming — Get nominations received by current user */
export const getIncomingNominations = async (req, res, next) => {
  try {
    const nominations = await Nomination.find({ nomineeId: req.userId })
      .populate('nominatorId', 'firstName lastName profilePicture')
      .sort({ createdAt: -1 });

    return sendResponse(res, HTTP_STATUS.OK, 'Incoming nominations', nominations);
  } catch (error) {
    next(error);
  }
};

/** POST /api/nominations — Nominate a buddy by email */
export const nominateBuddy = async (req, res, next) => {
  try {
    const nomineeEmail = req.body.nomineeEmail?.trim().toLowerCase();
    const { nomineeName, message } = req.body;

    if (!nomineeEmail) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'nomineeEmail is required');
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(nomineeEmail)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Please provide a valid nomineeEmail');
    }

    // Check if already nominated
    const existing = await Nomination.findOne({ nominatorId: req.userId, nomineeEmail });
    if (existing) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'You have already nominated this person');
    }

    // Find if nominee is registered
    const nomineeUser = await User.findOne({ email: nomineeEmail });
    if (nomineeUser && String(nomineeUser._id) === String(req.userId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'You cannot nominate yourself');
    }

    const inviteCode = Math.random().toString(36).substring(2, 8).toUpperCase();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000); // 7 days

    const nomination = await Nomination.create({
      nominatorId: req.userId,
      nomineeEmail,
      nomineeName,
      message,
      nomineeId: nomineeUser?._id || null,
      status: 'pending',
      inviteCode,
      expiresAt,
    });

    logger.info('buddy_nominated', {
      action: 'buddy_nominated',
      nominatorId: req.userId,
      nomineeEmail,
      nomineeFound: !!nomineeUser,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Nomination sent successfully!', nomination);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/nominations/:id/respond — Accept or decline nomination */
export const respondToNomination = async (req, res, next) => {
  try {
    const { status } = req.body; // 'accepted' | 'declined'

    if (!['accepted', 'declined'].includes(status)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'status must be accepted or declined');
    }

    const updates = { status };
    if (status === 'accepted') updates.acceptedAt = new Date();
    if (status === 'declined') updates.rejectedAt = new Date();

    const nomination = await Nomination.findOneAndUpdate(
      { _id: req.params.id, nomineeId: req.userId },
      updates,
      { new: true }
    );

    if (!nomination) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Nomination not found');

    logger.info('nomination_responded', {
      action: 'nomination_responded',
      userId: req.userId,
      nominationId: nomination._id,
      status,
    });

    return sendResponse(res, HTTP_STATUS.OK, `Nomination ${status}`, nomination);
  } catch (error) {
    next(error);
  }
};
