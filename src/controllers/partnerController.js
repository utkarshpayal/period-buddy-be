import Partner from '../models/Partner.js';
import PartnerMessage from '../models/PartnerMessage.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import CycleSettings from '../models/CycleSettings.js';
import CycleLog from '../models/CycleLog.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import { computeCyclePredictions } from '../utils/cycle.js';
import { broadcastToRoom } from '../config/websocket.js';
import { generateCareSuggestions } from '../utils/caringEngine.js';


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

    const me = await User.findById(req.userId);
    if (!me) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'User not found');
    }

    const partnerProfile = await Partner.findOne({
      inviteCode,
      inviteCodeExpiry: { $gt: new Date() },
    });

    if (!partnerProfile) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Invalid or expired invite code');
    }

    const ownerUser = await User.findById(partnerProfile.userId);
    if (!ownerUser || ownerUser.role !== 'user') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'You can only connect to a regular User account');
    }

    if (String(partnerProfile.userId) === String(req.userId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'You cannot connect with yourself');
    }

    // Automatically update the connector's role to 'partner' to align with the connection.
    if (me.role !== 'partner') {
      me.role = 'partner';
      await me.save();
    }

    // Link both sides. The inviter (owner of the code) keeps the "owner" role —
    // their data is what gets shared. The connector becomes the read-only "viewer".
    await Partner.findOneAndUpdate(
      { userId: partnerProfile.userId },
      {
        partnerId: req.userId,
        role: 'owner',
        isConnected: true,
        connectionStatus: 'connected',
        connectedAt: new Date(),
        $unset: { inviteCode: '', inviteCodeExpiry: '' },
      },
      { new: true }
    );

    await Partner.findOneAndUpdate(
      { userId: req.userId },
      { partnerId: partnerProfile.userId, role: 'viewer', isConnected: true, connectionStatus: 'connected', connectedAt: new Date() },
      { upsert: true, new: true }
    );

    // Create notifications for connection success
    await Notification.create({
      userId: partnerProfile.userId,
      type: 'system',
      title: 'Partner Connected 🎉',
      body: `${me.firstName} ${me.lastName} is now synced as your partner.`,
      sentAt: new Date(),
    });

    const notifViewer = await Notification.create({
      userId: req.userId,
      type: 'system',
      title: 'Connected to Partner 🎉',
      body: `You are now synced with ${ownerUser.firstName} ${ownerUser.lastName}.`,
      sentAt: new Date(),
    });

    broadcastToRoom(`user_${partnerProfile.userId}`, {
      type: 'partner_notification',
      notification: { title: 'Partner Connected 🎉', body: `${me.firstName} ${me.lastName} is now synced as your partner.` }
    });

    broadcastToRoom(`user_${req.userId}`, {
      type: 'partner_notification',
      notification: notifViewer
    });

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

    const updatedUser = await User.findById(req.userId).select('firstName lastName');
    const name = updatedUser ? `${updatedUser.firstName}` : 'Your partner';
    await createPartnerNotification(
      req.userId,
      'system',
      'Permissions Updated 🔒',
      `${name} updated their data sharing permissions.`
    );

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
    // Block explicit owners from reading this endpoint. Connections made
    // before the owner/viewer split don't have `role` set at all (it
    // defaults to null) — treat those as viewers too so pre-existing
    // partner connections don't start 403ing once this ships.
    if (myProfile.role === 'owner') {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Only the connected partner can view shared data');
    }

    const partnerProfile = await Partner.findOne({ userId: myProfile.partnerId });
    const perms = partnerProfile?.permissions || {};

    const data = {
      permissions: perms,
    };

    // Alerts depend on cycle predictions but are a distinct permission from
    // shareCyclePhase, so predictions are computed independently of whether
    // the phase itself is shared (previously alerts silently broke when
    // shareCyclePhase was off, since it reused `data.cycle`).
    let predictions = null;
    if (perms.shareCyclePhase || perms.shareAlerts) {
      const settings = await CycleSettings.findOne({ userId: myProfile.partnerId });
      if (settings) {
        predictions = computeCyclePredictions(settings);
      }
    }

    if (perms.shareCyclePhase && predictions) {
      data.cycle = {
        currentPhase: predictions.currentPhase,
        currentCycleDay: predictions.currentCycleDay,
        nextPeriodDaysAway: predictions.nextPeriodDaysAway,
        nextPeriodDate: predictions.nextPeriodDate,
        fertileWindowRange: predictions.fertileWindowRange,
        ovulationDaysAway: predictions.ovulationDaysAway,
      };
    }
    if (perms.shareSymptoms) {
      const logs = await CycleLog.find({ userId: myProfile.partnerId })
        .sort({ dateKey: -1 })
        .limit(7)
        .select('dateKey symptoms mood energy flow sleepHours waterIntake weight temperature stressLevel');

      data.recentSymptoms = logs.map((log) => ({
        dateKey: log.dateKey,
        symptoms: log.symptoms,
        mood: log.mood,
        energy: log.energy,
        flow: log.flow,
        sleepHours: log.sleepHours,
        waterIntake: log.waterIntake,
        weight: log.weight,
        temperature: log.temperature,
        stressLevel: log.stressLevel,
      }));
    }

    if (perms.shareIntimacyLog) {
      const intimacyLogs = await CycleLog.find({ userId: myProfile.partnerId, note: { $ne: '' } })
        .sort({ dateKey: -1 })
        .limit(7)
        .select('dateKey note');

      data.intimacyLogs = intimacyLogs.map((log) => ({
        dateKey: log.dateKey,
        note: log.note,
      }));
    }

    // Streak is low-sensitivity engagement info (not personal health data),
    // so it's shown to any connected partner regardless of the four
    // permission toggles above.
    const ownerUser = await User.findById(myProfile.partnerId).select('streakCount');
    if (ownerUser) {
      data.streak = { count: ownerUser.streakCount ?? 0 };
    }
    if (perms.shareAlerts) {
      data.alerts = predictions && predictions.nextPeriodDaysAway <= 3
        ? ['Next period is expected soon. Offer gentle reminders and support.']
        : [];
    }

    // Generate care advice suggestions based on permissions and cycle/logs
    data.careSuggestions = generateCareSuggestions(perms, data.cycle, data.recentSymptoms || []);

    return sendResponse(res, HTTP_STATUS.OK, 'Partner shared data', data);
  } catch (error) {
    next(error);
  }
};

/** GET /api/partner/messages — Get chat messages */
export const getMessages = async (req, res, next) => {
  try {
    const profile = await Partner.findOne({ userId: req.userId });
    if (!profile) return sendResponse(res, HTTP_STATUS.OK, 'Messages', []);

    const messages = await PartnerMessage.find({ partnerId: profile._id }).sort({ sentAt: 1 });

    if (messages.length === 0 && profile.messages && profile.messages.length > 0) {
      return sendResponse(res, HTTP_STATUS.OK, 'Messages', profile.messages);
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Messages', messages);
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

    // Save message in user profile (deprecated)
    myProfile.messages.push({ sender: 'user', text: text.trim() });
    await myProfile.save();

    const msgUser = await PartnerMessage.create({
      partnerId: myProfile._id,
      sender: 'user',
      text: text.trim(),
    });

    broadcastToRoom(`partner_${myProfile._id}`, {
      message: msgUser,
    });

    // Also push to partner profile
    const partnerProfile = await Partner.findOne({ userId: myProfile.partnerId });
    if (partnerProfile) {
      partnerProfile.messages.push({ sender: 'partner', text: text.trim() });
      await partnerProfile.save();

      const msgPartner = await PartnerMessage.create({
        partnerId: partnerProfile._id,
        sender: 'partner',
        text: text.trim(),
      });

      broadcastToRoom(`partner_${partnerProfile._id}`, {
        message: msgPartner,
      });
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Message sent', msgUser);
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
      { partnerId: null, role: null, isConnected: false, connectionStatus: 'disconnected', connectedAt: null }
    );

    logger.info('partner_disconnected', { action: 'partner_disconnected', userId: req.userId, partnerId });

    return sendResponse(res, HTTP_STATUS.OK, 'Partner disconnected');
  } catch (error) {
    next(error);
  }
};

/** GET /api/partner/notifications — Get partner's notifications */
export const getNotifications = async (req, res, next) => {
  try {
    const notifications = await Notification.find({ userId: req.userId })
      .sort({ createdAt: -1 })
      .limit(50);
    return sendResponse(res, HTTP_STATUS.OK, 'Notifications fetched successfully', notifications);
  } catch (error) {
    next(error);
  }
};

/** POST /api/partner/notifications/:id/read — Mark notification as read */
export const markNotificationAsRead = async (req, res, next) => {
  try {
    const { id } = req.params;
    const notification = await Notification.findOneAndUpdate(
      { _id: id, userId: req.userId },
      { isRead: true, readAt: new Date() },
      { new: true }
    );
    if (!notification) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Notification not found');
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Notification marked as read', notification);
  } catch (error) {
    next(error);
  }
};

/** Helper function to create a notification for the connected partner */
export const createPartnerNotification = async (ownerId, type, title, body) => {
  try {
    const connection = await Partner.findOne({ userId: ownerId, isConnected: true });
    if (connection && connection.partnerId) {
      const partnerId = connection.partnerId;

      const notification = await Notification.create({
        userId: partnerId,
        type,
        title,
        body,
        sentAt: new Date()
      });

      broadcastToRoom(`user_${partnerId}`, {
        type: 'partner_notification',
        notification
      });

      logger.info('partner_notification_created', { partnerId, type });
    }
  } catch (err) {
    logger.error('create_partner_notification_error', { ownerId, error: err.message });
  }
};
