import Partner from '../models/Partner.js';
import PartnerMessage from '../models/PartnerMessage.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import Document from '../models/Document.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import CycleSettings from '../models/CycleSettings.js';
import CycleLog from '../models/CycleLog.js';
import logger from '../utils/logger.js';
import crypto from 'crypto';
import { computeCyclePredictions } from '../utils/cycle.js';
import { loadPredictionLogs } from '../utils/predictionLogs.js';
import { broadcastToRoom } from '../config/websocket.js';
import {
  buildPagination,
  getPagination,
  isPaginatedRequest,
  sendPaginatedList,
  clientToday,
} from '../utils/apiHelpers.js';
import { generateCareSuggestions } from '../utils/careSuggestionsAi.js';
import { ACTIVE_ACCOUNT_FILTER } from '../utils/accountStatus.js';
import { aiAllowed } from '../utils/privacy.js';

/** Whether the other side of a pairing is a live account. Deleting an
 * account severs the pairing (utils/accountLifecycle.js), but a suspended
 * one keeps it — so readers must refuse inactive counterparts themselves. */
const isLiveAccount = async (userId) =>
  Boolean(userId) && Boolean(await User.exists({ _id: userId, ...ACTIVE_ACCOUNT_FILTER }));

// lastName is optional, so never leave a trailing space or "undefined".
const fullName = (user) => [user?.firstName, user?.lastName].filter(Boolean).join(' ');

const CARE_SUGGESTIONS_CACHE_MS = 24 * 60 * 60 * 1000;

function generateCode() {
  return `NURA-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}

/** GET /api/partner — Get or create partner profile */
export const getPartnerProfile = async (req, res, next) => {
  try {
    let profile = await Partner.findOne({ userId: req.userId }).populate(
      'partnerId',
      'firstName lastName',
    );
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
      { new: true, upsert: true },
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

    const ownerUser = await User.findOne({ _id: partnerProfile.userId, ...ACTIVE_ACCOUNT_FILTER });
    if (!ownerUser) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Invalid or expired invite code');
    }
    if (ownerUser.role === 'partner') {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'You can only connect to a regular User account',
      );
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
      { new: true },
    );

    await Partner.findOneAndUpdate(
      { userId: req.userId },
      {
        partnerId: partnerProfile.userId,
        role: 'viewer',
        isConnected: true,
        connectionStatus: 'connected',
        connectedAt: new Date(),
      },
      { upsert: true, new: true },
    );

    // Create notifications for connection success
    await Notification.create({
      userId: partnerProfile.userId,
      type: 'system',
      title: 'Partner Connected 🎉',
      body: `${fullName(me)} is now synced as your partner.`,
      sentAt: new Date(),
    });

    const notifViewer = await Notification.create({
      userId: req.userId,
      type: 'system',
      title: 'Connected to Partner 🎉',
      body: `You are now synced with ${fullName(ownerUser)}.`,
      sentAt: new Date(),
    });

    broadcastToRoom(`user_${partnerProfile.userId}`, {
      type: 'partner_notification',
      notification: {
        title: 'Partner Connected 🎉',
        body: `${fullName(me)} is now synced as your partner.`,
      },
    });

    broadcastToRoom(`user_${req.userId}`, {
      type: 'partner_notification',
      notification: notifViewer,
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
          ...(shareCyclePhase !== undefined && {
            'permissions.shareCyclePhase': Boolean(shareCyclePhase),
          }),
          ...(shareSymptoms !== undefined && {
            'permissions.shareSymptoms': Boolean(shareSymptoms),
          }),
          ...(shareIntimacyLog !== undefined && {
            'permissions.shareIntimacyLog': Boolean(shareIntimacyLog),
          }),
          ...(shareAlerts !== undefined && { 'permissions.shareAlerts': Boolean(shareAlerts) }),
        },
      },
      { new: true, upsert: true },
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
      `${name} updated their data sharing permissions.`,
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
      return sendError(
        res,
        HTTP_STATUS.FORBIDDEN,
        'Only the connected partner can view shared data',
      );
    }

    const partnerProfile = await Partner.findOne({ userId: myProfile.partnerId });
    if (!partnerProfile || !(await isLiveAccount(myProfile.partnerId))) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'No partner connected');
    }
    const perms = partnerProfile.permissions || {};

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
        // Anchor on the owner's actual logged period history, not just the
        // configured lastPeriodStartDate, so the phase shown to the partner
        // matches what the owner's own tracker screen shows.
        const logs = await loadPredictionLogs(myProfile.partnerId);
        predictions = computeCyclePredictions(settings, logs, { today: clientToday(req) });
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
        .select(
          'dateKey symptoms mood energy flow sleepHours waterIntake weight temperature stressLevel',
        );

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
      // Only days explicitly tagged `isIntimate` — a day's `note` is a
      // free-text diary field (symptoms, mood, anything) and was previously
      // used as the intimacy signal, which leaked unrelated private notes.
      const intimacyLogs = await CycleLog.find({ userId: myProfile.partnerId, isIntimate: true })
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
    const ownerUser = await User.findById(myProfile.partnerId).select('streakCount consents');
    if (ownerUser) {
      data.streak = { count: ownerUser.streakCount ?? 0 };
    }
    if (perms.shareAlerts) {
      data.alerts =
        predictions && predictions.nextPeriodDaysAway <= 3
          ? ['Next period is expected soon. Offer gentle reminders and support.']
          : [];
    }

    // Generate care advice suggestions based on permissions and cycle/logs —
    // via Sarvam when configured (see careSuggestionsAi.js), falling back to
    // the rule-based caringEngine otherwise. Cached on the owner's Partner
    // doc and only regenerated when new data has actually been logged (or
    // the cache is a day old), so this screen doesn't trigger an AI call on
    // every load.
    const latestLogDateKey = data.recentSymptoms?.[0]?.dateKey || null;
    const cache = partnerProfile?.careSuggestionsCache;
    const cacheIsFresh =
      cache?.generatedAt &&
      (latestLogDateKey
        ? cache.latestLogDateKey === latestLogDateKey
        : Date.now() - new Date(cache.generatedAt).getTime() < CARE_SUGGESTIONS_CACHE_MS);

    if (cacheIsFresh) {
      data.careSuggestions = {
        suggestions: cache.suggestions || [],
        dos: cache.dos || [],
        donts: cache.donts || [],
      };
    } else {
      let documents = [];
      if (perms.shareReports) {
        documents = await Document.find({ userId: myProfile.partnerId })
          .sort({ documentDate: -1 })
          .limit(5)
          .select('title docType documentDate extractedText');
      }

      data.careSuggestions = await generateCareSuggestions({
        permissions: perms,
        cycle: data.cycle,
        recentLogs: data.recentSymptoms || [],
        documents,
        // It's the owner's data going to the AI provider: their consent counts.
        useAi: aiAllowed(ownerUser),
      });

      if (partnerProfile) {
        partnerProfile.careSuggestionsCache = {
          generatedAt: new Date(),
          latestLogDateKey,
          suggestions: data.careSuggestions.suggestions,
          dos: data.careSuggestions.dos,
          donts: data.careSuggestions.donts,
        };
        await partnerProfile.save();
      }
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
    if (!profile) return sendResponse(res, HTTP_STATUS.OK, 'Messages', []);

    // Cap to the most recent 300 messages (newest-first, then restored to
    // chronological order) to bound the payload on long conversations.
    const messages = (
      await PartnerMessage.find({ partnerId: profile._id }).sort({ sentAt: -1 }).limit(300)
    ).reverse();

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
    if (text.trim().length > 1000)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message must be 1000 characters or fewer');

    const myProfile = await Partner.findOne({ userId: req.userId });
    if (!myProfile?.isConnected || !(await isLiveAccount(myProfile.partnerId))) {
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
      {
        partnerId: null,
        role: null,
        isConnected: false,
        connectionStatus: 'disconnected',
        connectedAt: null,
      },
    );

    // Tell both sides in real time. The other side's app only stores its
    // partner role on-device, so without this a viewer disconnected by the
    // owner stays on the (now empty) partner view until the app next
    // re-checks the role. Clients auto-join their personal `user_<id>` room
    // on connect (config/websocket.js). The Notification doc also sends a
    // push via its post-save hook, so an offline partner learns why too.
    try {
      const me = await User.findById(req.userId).select('firstName lastName');
      const myName = [me?.firstName, me?.lastName].filter(Boolean).join(' ') || 'Your partner';
      const notifOther = await Notification.create({
        userId: partnerId,
        type: 'system',
        title: 'Partner connection ended',
        body: `${myName} ended your partner connection.`,
        sentAt: new Date(),
      });
      broadcastToRoom(`user_${partnerId}`, {
        type: 'partner_disconnected',
        notification: notifOther,
      });
      broadcastToRoom(`user_${req.userId}`, { type: 'partner_disconnected' });
    } catch (notifyError) {
      // The disconnect itself already succeeded — don't fail the request.
      logger.error('partner_disconnect_notify_error', {
        userId: req.userId,
        partnerId,
        error: notifyError.message,
      });
    }

    logger.info('partner_disconnected', {
      action: 'partner_disconnected',
      userId: req.userId,
      partnerId,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Partner disconnected');
  } catch (error) {
    next(error);
  }
};

/** GET /api/partner/notifications — Get partner's notifications */
/**
 * GET /api/partner/notifications — newest first, paginated with ?page=&limit=
 * (default 20, max 50). `data` stays a plain array so app builds from before
 * pagination keep working (they send no page and get the first 50, same as
 * before); `pagination` and `unreadCount` ride alongside it on the envelope.
 * `unreadCount` covers *all* notifications, not just this page, so a client
 * can show an accurate unread badge without loading the whole list.
 */
export const getNotifications = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, {
      limit: isPaginatedRequest(req.query) ? 20 : 50,
      maxLimit: 50,
    });
    const filter = { userId: req.userId };
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).sort({ createdAt: -1, _id: -1 }).skip(skip).limit(limit),
      Notification.countDocuments(filter),
      Notification.countDocuments({ ...filter, isRead: false }),
    ]);
    return sendPaginatedList(
      res,
      'Notifications fetched successfully',
      notifications,
      buildPagination({ page, limit, total }),
      { unreadCount },
    );
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
      { new: true },
    );
    if (!notification) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Notification not found');
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Notification marked as read', notification);
  } catch (error) {
    next(error);
  }
};

/** POST /api/partner/notifications/read-all — mark every unread notification read. */
export const markAllNotificationsAsRead = async (req, res, next) => {
  try {
    const result = await Notification.updateMany(
      { userId: req.userId, isRead: false },
      { isRead: true, readAt: new Date() },
    );
    return sendResponse(res, HTTP_STATUS.OK, 'All notifications marked as read', {
      updated: result.modifiedCount,
    });
  } catch (error) {
    next(error);
  }
};

/** Helper function to create a notification for the connected partner */
export const createPartnerNotification = async (ownerId, type, title, body) => {
  try {
    const connection = await Partner.findOne({ userId: ownerId, isConnected: true });
    if (connection && connection.partnerId && (await isLiveAccount(connection.partnerId))) {
      const partnerId = connection.partnerId;

      const notification = await Notification.create({
        userId: partnerId,
        type,
        title,
        body,
        sentAt: new Date(),
      });

      broadcastToRoom(`user_${partnerId}`, {
        type: 'partner_notification',
        notification,
      });

      logger.info('partner_notification_created', { partnerId, type });
    }
  } catch (err) {
    logger.error('create_partner_notification_error', { ownerId, error: err.message });
  }
};
