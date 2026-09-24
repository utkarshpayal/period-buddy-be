import User from '../models/User.js';
import PushBroadcast, {
  BROADCAST_AUDIENCES,
  MAX_SELECTED_RECIPIENTS,
} from '../models/PushBroadcast.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  getPagination,
  buildPagination,
  isValidObjectId,
  escapeRegex,
} from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { isFcmReady, sendPushNotification } from '../utils/fcm.js';
import { buildAudienceFilter, enqueueBroadcast, laneFor } from '../utils/pushBroadcastWorker.js';

const TITLE_MAX = 100;
const BODY_MAX = 500;

const parseMessage = (body = {}) => {
  const title = typeof body.title === 'string' ? body.title.trim() : '';
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!title) return { error: 'Title is required' };
  if (!text) return { error: 'Message is required' };
  if (title.length > TITLE_MAX) return { error: `Title must be at most ${TITLE_MAX} characters` };
  if (text.length > BODY_MAX) return { error: `Message must be at most ${BODY_MAX} characters` };
  return { title, body: text };
};

const parseAudience = (value) => (BROADCAST_AUDIENCES.includes(value) ? value : 'all');

// History/list responses never need the (possibly thousands-long) id list.
const HIDDEN_FIELDS = '-cursor -leaseUntil -userIds';

const parseUserIds = (value) => {
  if (!Array.isArray(value) || value.length === 0) {
    return { error: 'Pick at least one recipient' };
  }
  const ids = [...new Set(value.map(String))];
  if (ids.length > MAX_SELECTED_RECIPIENTS) {
    return {
      error: `You can pick at most ${MAX_SELECTED_RECIPIENTS} recipients — send to an audience instead`,
    };
  }
  if (!ids.every(isValidObjectId)) return { error: 'Invalid recipient id' };
  return { ids };
};

const displayName = (u) =>
  [u.firstName, u.lastName].filter(Boolean).join(' ') || u.email || String(u._id);

const countAudience = async (audience, userIds) => {
  const filter = buildAudienceFilter(audience, userIds);
  const [totalUsers, totalWithToken] = await Promise.all([
    User.countDocuments(filter),
    User.countDocuments({ ...filter, notificationToken: { $nin: [null, ''] } }),
  ]);
  return { totalUsers, totalWithToken };
};

/**
 * GET /api/admin/notifications/audience?audience=all|user|partner|doctor —
 * how many users a broadcast would reach, shown before sending.
 */
export const getAudienceCount = async (req, res, next) => {
  try {
    const audience = parseAudience(req.query.audience);
    if (audience === 'selected') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Use an audience role, not "selected"');
    }
    const counts = await countAudience(audience);
    return sendResponse(res, HTTP_STATUS.OK, 'Audience counted', {
      audience,
      ...counts,
      fcmConfigured: isFcmReady(),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/notifications/recipients?search= — find users to hand-pick
 * as recipients. Returns whether each has a registered device, never the
 * token itself.
 */
export const searchRecipients = async (req, res, next) => {
  try {
    const search = typeof req.query.search === 'string' ? req.query.search.trim() : '';
    if (search.length < 2) {
      return sendResponse(res, HTTP_STATUS.OK, 'Recipients fetched', { users: [] });
    }
    const rx = new RegExp(escapeRegex(search), 'i');
    const users = await User.find({
      ...buildAudienceFilter('all'),
      $or: [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }],
    })
      .select('firstName lastName email phone role profilePicture notificationToken')
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return sendResponse(res, HTTP_STATUS.OK, 'Recipients fetched', {
      users: users.map(({ notificationToken, ...u }) => ({
        ...u,
        hasDevice: Boolean(notificationToken),
      })),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/notifications/test — send the message to one user (by
 * email) right away, so an admin can preview it on a real device before
 * broadcasting.
 */
export const sendTestNotification = async (req, res, next) => {
  try {
    const msg = parseMessage(req.body);
    if (msg.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, msg.error);
    if (!isFcmReady()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Push notifications are not configured',
      );
    }

    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Email is required');

    const user = await User.findOne({ email }).select('_id notificationToken');
    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No user with that email');
    if (!user.notificationToken) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'That user has no registered device — they need to log in on the app first',
      );
    }

    const messageId = await sendPushNotification(user.notificationToken, {
      title: msg.title,
      body: msg.body,
      data: { type: 'system', test: 'true' },
    });
    if (!messageId) {
      return sendError(res, HTTP_STATUS.BAD_GATEWAY, 'Firebase rejected the notification');
    }

    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_TEST_SENT,
      resourceType: 'user',
      resourceId: user._id,
      metadata: { title: msg.title },
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Test notification sent', { messageId });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/notifications/broadcasts — queue a push to every user in
 * the audience. Returns 202 immediately; the worker sends in batches in the
 * background and the admin polls GET /broadcasts/:id for progress.
 * Body: { title, body, audience?, saveToInbox? }
 */
export const createBroadcast = async (req, res, next) => {
  try {
    const msg = parseMessage(req.body);
    if (msg.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, msg.error);
    if (!isFcmReady()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Push notifications are not configured',
      );
    }

    const audience = parseAudience(req.body.audience);

    let userIds;
    let recipientPreview;
    if (audience === 'selected') {
      const parsed = parseUserIds(req.body.userIds);
      if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
      userIds = parsed.ids;
      const preview = await User.find(buildAudienceFilter('selected', userIds))
        .select('firstName lastName email')
        .limit(3)
        .lean();
      recipientPreview = preview.map(displayName);
    } else {
      // Guard against accidental double-clicks sending the same blast twice.
      // Hand-picked sends are exempt: they run in their own worker lane.
      const inFlight = await PushBroadcast.exists({
        status: { $in: ['queued', 'running'] },
        audience: { $ne: 'selected' },
      });
      if (inFlight) {
        return sendError(
          res,
          HTTP_STATUS.CONFLICT,
          'Another broadcast is still sending. Wait for it to finish or cancel it first.',
        );
      }
    }

    const counts = await countAudience(audience, userIds);
    if (counts.totalUsers === 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'No active users match these recipients');
    }

    const broadcast = await PushBroadcast.create({
      title: msg.title,
      body: msg.body,
      audience,
      userIds,
      recipientPreview,
      saveToInbox: req.body.saveToInbox !== false,
      ...counts,
      createdBy: req.userId,
    });

    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_BROADCAST_CREATED,
      resourceType: 'push_broadcast',
      resourceId: broadcast._id,
      metadata: { title: msg.title, audience, lane: laneFor(audience), ...counts },
    });

    enqueueBroadcast(broadcast._id, audience);

    const { userIds: _omit, ...payload } = broadcast.toObject();
    return sendResponse(res, HTTP_STATUS.ACCEPTED, 'Broadcast queued', { broadcast: payload });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/notifications/broadcasts — paginated history, newest first. */
export const listBroadcasts = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const [broadcasts, total] = await Promise.all([
      PushBroadcast.find()
        .select(HIDDEN_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'firstName lastName email')
        .lean(),
      PushBroadcast.countDocuments(),
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Broadcasts fetched', {
      broadcasts,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/notifications/broadcasts/:id — progress of one broadcast. */
export const getBroadcast = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid broadcast id');
    }
    const broadcast = await PushBroadcast.findById(req.params.id)
      .select(HIDDEN_FIELDS)
      .populate('createdBy', 'firstName lastName email')
      .lean();
    if (!broadcast) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Broadcast not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Broadcast fetched', { broadcast });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/notifications/broadcasts/:id/cancel — a queued broadcast is
 * cancelled at once; a running one stops after its current batch.
 */
export const cancelBroadcast = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid broadcast id');
    }
    const { id } = req.params;

    let broadcast = await PushBroadcast.findOneAndUpdate(
      { _id: id, status: 'queued' },
      { $set: { status: 'cancelled', cancelRequested: true, completedAt: new Date() } },
      { new: true, projection: HIDDEN_FIELDS },
    );
    if (!broadcast) {
      broadcast = await PushBroadcast.findOneAndUpdate(
        { _id: id, status: 'running' },
        { $set: { cancelRequested: true } },
        { new: true, projection: HIDDEN_FIELDS },
      );
    }
    if (!broadcast) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'Only a queued or sending broadcast can be cancelled',
      );
    }

    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_BROADCAST_CANCELLED,
      resourceType: 'push_broadcast',
      resourceId: id,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Cancellation requested', { broadcast });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/notifications/broadcasts/:id/retry — resume a failed
 * broadcast from the batch it stopped at (users already sent to are skipped).
 */
export const retryBroadcast = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid broadcast id');
    }
    if (!isFcmReady()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Push notifications are not configured',
      );
    }

    const broadcast = await PushBroadcast.findOneAndUpdate(
      { _id: req.params.id, status: 'failed' },
      { $set: { status: 'queued', completedAt: null, leaseUntil: null } },
      { new: true, projection: HIDDEN_FIELDS },
    );
    if (!broadcast) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'Only a failed broadcast can be retried');
    }

    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_BROADCAST_RETRIED,
      resourceType: 'push_broadcast',
      resourceId: broadcast._id,
    });

    enqueueBroadcast(broadcast._id, broadcast.audience);

    return sendResponse(res, HTTP_STATUS.ACCEPTED, 'Broadcast resumed', { broadcast });
  } catch (error) {
    next(error);
  }
};
