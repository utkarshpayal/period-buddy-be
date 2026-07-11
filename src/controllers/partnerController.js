import Partner from '../models/Partner.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import CycleSettings from '../models/CycleSettings.js';
import CycleLog from '../models/CycleLog.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import { computeCyclePredictions } from '../utils/cycle.js';

function generateCode() {
  return `NURA-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** GET /api/partner — Get or create partner profile */
export const getPartnerProfile = async (req, res, next) => {
  try {
    let profile = await Partner.findOne({ userId: req.userId }).populate('partnerId', 'firstName lastName');
    if (!profile) {
      profile = await Partner.create({ userId: req.userId });
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Partner profile', profile);
  } catch (error) {
    next(error);
  }
};

/** POST /api/partner/invite — Generate an invite code */
export const generateInviteCode = async (req, res, next) => {
  try {
    const code = generateCode();
    const expiry = new Date(Date.now() + 48 * 60 * 60 * 1000); // 48 hrs

    const profile = await Partner.findOneAndUpdate(
      { userId: req.userId },
      { inviteCode: code, inviteCodeExpiry: expiry },
      { new: true, upsert: true }
    );

    logger.info('partner_invite_generated', {
      action: 'partner_invite_generated',
      userId: req.userId,
      code,
      expiresAt: expiry,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Invite code generated', {
      inviteCode: profile.inviteCode,
      expiresAt: expiry,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/partner/connect — Connect using an invite code */
export const connectPartner = async (req, res, next) => {
  try {
    const inviteCode = req.body.inviteCode?.trim().toUpperCase();
    if (!inviteCode) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'inviteCode is required');

    const partnerProfile = await Partner.findOne({
      inviteCode,
      inviteCodeExpiry: { $gt: new Date() },
    });

    if (!partnerProfile) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Invalid or expired invite code');
    }

    if (String(partnerProfile.userId) === String(req.userId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'You cannot connect with yourself');
    }

    // Link both sides
    await Partner.findOneAndUpdate(
      { userId: partnerProfile.userId },
      { partnerId: req.userId, isConnected: true, connectedAt: new Date(), inviteCode: null, inviteCodeExpiry: null },
      { new: true }
    );

    await Partner.findOneAndUpdate(
      { userId: req.userId },
      { partnerId: partnerProfile.userId, isConnected: true, connectedAt: new Date() },
      { upsert: true, new: true }
    );

    logger.info('partner_connected', {
      action: 'partner_connected',
      userId: req.userId,
      partnerId: partnerProfile.userId,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Partner connected successfully!');
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/partner/permissions — Update sharing permissions */
export const updatePermissions = async (req, res, next) => {
  try {
    const { shareCyclePhase, shareSymptoms, shareIntimacyLog, shareAlerts } = req.body;

    const profile = await Partner.findOneAndUpdate(
      { userId: req.userId },
      {
        $set: {
          ...(shareCyclePhase !== undefined && { 'permissions.shareCyclePhase': Boolean(shareCyclePhase) }),
          ...(shareSymptoms !== undefined && { 'permissions.shareSymptoms': Boolean(shareSymptoms) }),
          ...(shareIntimacyLog !== undefined && { 'permissions.shareIntimacyLog': Boolean(shareIntimacyLog) }),
          ...(shareAlerts !== undefined && { 'permissions.shareAlerts': Boolean(shareAlerts) }),
        },
      },
      { new: true, upsert: true }
    );

    logger.info('partner_permissions_updated', {
      action: 'partner_permissions_updated',
      userId: req.userId,
      permissions: profile.permissions,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Permissions updated', profile.permissions);
  } catch (error) {
    next(error);
  }
};

/** GET /api/partner/shared-data — Get partner's shared cycle data (respects permissions) */
export const getPartnerSharedData = async (req, res, next) => {
  try {
    const myProfile = await Partner.findOne({ userId: req.userId });
    if (!myProfile?.partnerId) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'No partner connected');
    }

    const partnerProfile = await Partner.findOne({ userId: myProfile.partnerId });
    const perms = partnerProfile?.permissions || {};

    const data = {
      permissions: perms,
    };
    if (perms.shareCyclePhase) {
      const settings = await CycleSettings.findOne({ userId: myProfile.partnerId });
      if (settings) {
        const predictions = computeCyclePredictions(settings);
        data.cycle = {
          currentPhase: predictions.currentPhase,
          currentCycleDay: predictions.currentCycleDay,
          nextPeriodDaysAway: predictions.nextPeriodDaysAway,
          nextPeriodDate: predictions.nextPeriodDate,
        };
      }
    }
    if (perms.shareSymptoms) {
      const logs = await CycleLog.find({ userId: myProfile.partnerId })
        .sort({ dateKey: -1 })
        .limit(7)
        .select('dateKey symptoms mood energy flow note');

      data.recentSymptoms = logs.map((log) => ({
        dateKey: log.dateKey,
        symptoms: log.symptoms,
        mood: log.mood,
        energy: log.energy,
        flow: log.flow,
      }));
    }
    if (perms.shareAlerts) {
      data.alerts = data.cycle?.nextPeriodDaysAway <= 3
        ? ['Next period is expected soon. Offer gentle reminders and support.']
        : [];
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Partner shared data', data);
  } catch (error) {
    next(error);
  }
};

/** GET /api/partner/messages — Get chat messages */
export const getMessages = async (req, res, next) => {
  try {
    const profile = await Partner.findOne({ userId: req.userId });
    return sendResponse(res, HTTP_STATUS.OK, 'Messages', profile?.messages || []);
  } catch (error) {
    next(error);
  }
};

/** POST /api/partner/message — Send a message to partner */
export const sendMessage = async (req, res, next) => {
  try {
    const { text } = req.body;
    if (!text?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message text required');
    if (text.trim().length > 1000) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message must be 1000 characters or fewer');

    const myProfile = await Partner.findOne({ userId: req.userId });
    if (!myProfile?.isConnected) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'No connected partner');
    }

    // Save message in user profile
    myProfile.messages.push({ sender: 'user', text: text.trim() });
    await myProfile.save();

    // Also push to partner profile
    await Partner.findOneAndUpdate(
      { userId: myProfile.partnerId },
      { $push: { messages: { sender: 'partner', text: text.trim() } } }
    );

    return sendResponse(res, HTTP_STATUS.OK, 'Message sent', {
      text: text.trim(),
      sentAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/partner/disconnect — Disconnect partner */
export const disconnectPartner = async (req, res, next) => {
  try {
    const profile = await Partner.findOne({ userId: req.userId });
    if (!profile?.partnerId) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'No partner connected');
    }

    const partnerId = profile.partnerId;
    await Partner.updateMany(
      { userId: { $in: [req.userId, partnerId] } },
      { partnerId: null, isConnected: false, connectedAt: null }
    );

    logger.info('partner_disconnected', { action: 'partner_disconnected', userId: req.userId, partnerId });

    return sendResponse(res, HTTP_STATUS.OK, 'Partner disconnected');
  } catch (error) {
    next(error);
  }
};
