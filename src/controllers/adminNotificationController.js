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
import { pushTokensOf } from '../utils/pushTokens.js';
import { uploadBufferToS3 } from '../utils/s3.js';
import { assertAllowedUpload } from '../utils/fileValidation.js';
import {
  buildAudienceFilter,
  countAudience,
  enqueueBroadcast,
  laneFor,
} from '../utils/pushBroadcastWorker.js';
import { parseNotificationData, wantsStoreDefaults } from '../utils/notificationRoute.js';
import AppConfig from '../models/AppConfig.js';
import { CONFIG_KEY } from '../utils/appConfigStore.js';
import { mergeSettings } from '../utils/appConfig.js';
import { hidesNotificationDetails, pushFor } from '../utils/privacy.js';
import PushSchedule from '../models/PushSchedule.js';
import { describeSchedule, nextOccurrence, parseScheduleInput } from '../utils/pushSchedule.js';

/**
 * Route / store link / icon / image of an admin send. An app-update push
 * (`kind: 'app_update'`) without its own link uses the App settings' store
 * links (the CMS's Update prompt), so admins don't paste them each time.
 */
const parsePushData = async (body) => {
  let storeDefaults = {};
  if (wantsStoreDefaults(body)) {
    const config = await AppConfig.findOne({ key: CONFIG_KEY }).select('settings').lean();
    storeDefaults = mergeSettings(config?.settings).update;
  }
  return parseNotificationData(body, storeDefaults);
};

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

const RECIPIENT_FIELDS =
  'firstName lastName email phone role profilePicture notificationToken webPushTokens notificationsEnabled';

const toRecipient = ({ notificationToken, webPushTokens, notificationsEnabled, ...u }) => ({
  ...u,
  // "Can receive a push": has a registered device (phone or browser) and
  // hasn't turned notifications off in the app.
  hasDevice:
    pushTokensOf({ notificationToken, webPushTokens }).length > 0 && notificationsEnabled !== false,
});

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
      .select(RECIPIENT_FIELDS)
      .sort({ createdAt: -1 })
      .limit(20)
      .lean();

    return sendResponse(res, HTTP_STATUS.OK, 'Recipients fetched', {
      users: users.map(toRecipient),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/notifications/upload — upload a push's big-picture image
 * (multipart field "file"; JPG, PNG or WebP up to 1MB) to S3 under notifications/.
 * Returns { url, key }; the url goes in a send's `image`.
 */
export const uploadNotificationImage = async (req, res, next) => {
  try {
    if (!req.file) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'No file uploaded');
    let mimeType;
    try {
      mimeType = assertAllowedUpload(req.file.buffer, ['image']);
    } catch (validationError) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, validationError.message);
    }
    // The bytes decide, not the browser's claimed type (GIF/AVIF won't render in a push).
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Use a JPG, PNG or WebP image');
    }
    const { url, key } = await uploadBufferToS3({
      buffer: req.file.buffer,
      mimeType,
      originalName: req.file.originalname,
      folder: 'notifications',
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Image uploaded', { url, key });
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

    const pushData = await parsePushData(req.body);
    if (pushData.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, pushData.error);

    const email = typeof req.body.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    if (!email) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Email is required');

    const user = await User.findOne({ email }).select(
      '_id notificationToken webPushTokens notificationsEnabled privacySettings',
    );
    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No user with that email');
    const tokens = pushTokensOf(user);
    if (tokens.length === 0) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'That user has no registered device — they need to log in on the app first',
      );
    }
    if (user.notificationsEnabled === false) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'That user has turned notifications off in the app (Profile → Notifications)',
      );
    }

    // Same rule as every other push: a person who hides notification details
    // gets the neutral text, and the admin is told so.
    const detailsHidden = hidesNotificationDetails(user);
    const message = pushFor(user, {
      title: msg.title,
      body: msg.body,
      data: {
        type: 'system',
        test: 'true',
        ...pushData.data,
      },
    });
    // Every device: the phone and any browsers with web push on.
    const messageIds = await Promise.all(
      tokens.map((token) => sendPushNotification(token, message)),
    );
    const messageId = messageIds.find(Boolean);
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

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      detailsHidden
        ? 'Test notification sent. This user hides notification details, so their phone shows the neutral text.'
        : 'Test notification sent',
      { messageId, detailsHidden },
    );
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/notifications/broadcasts — queue a push to every user in
 * the audience. Returns 202 immediately; the worker sends in batches in the
 * background and the admin polls GET /broadcasts/:id for progress.
 * Body: { title, body, audience?, userIds?, saveToInbox?, route?, kind?, storeUrl?,
 * iosStoreUrl?, icon?, image? } — `route` is an optional in-app path (e.g.
 * "/tracker") the notification opens when tapped; `storeUrl`/`iosStoreUrl` a
 * store link it opens instead (allowlisted, see utils/notificationRoute.js);
 * `kind: 'app_update'` fills missing store links from App settings; `icon` one
 * of NOTIFICATION_ICONS; `image` an https big picture.
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

    // Optional in-app screen the tap opens, icon and big-picture image.
    const pushData = await parsePushData(req.body);
    if (pushData.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, pushData.error);

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
      data: pushData.data,
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

/* ----------------------- Scheduled / repeating pushes ----------------------- */

const SCHEDULE_HIDDEN_FIELDS = '-userIds';

const withDescription = (schedule) => ({ ...schedule, description: describeSchedule(schedule) });

/**
 * The first send at or after `startAt` that's still ahead of `now`, counting
 * sends already made. Null when the series has nothing left.
 */
const firstRunFrom = (timing, runCount, now) => {
  const justBefore = new Date(Math.max(now.getTime(), new Date(timing.startAt).getTime()) - 1);
  return nextOccurrence({ ...timing, runCount }, justBefore);
};

/**
 * Validate message + recipients + timing from a create/update body into the
 * fields a PushSchedule stores. `{ fields }` or `{ status, error }`.
 */
const buildScheduleFields = async (body, { allowPastStart }) => {
  const msg = parseMessage(body);
  if (msg.error) return { status: HTTP_STATUS.BAD_REQUEST, error: msg.error };

  const timing = parseScheduleInput(body, new Date(), { allowPastStart });
  if (timing.error) return { status: HTTP_STATUS.BAD_REQUEST, error: timing.error };

  const pushData = await parsePushData(body);
  if (pushData.error) return { status: HTTP_STATUS.BAD_REQUEST, error: pushData.error };

  const audience = parseAudience(body.audience);
  let userIds;
  let recipientPreview;
  if (audience === 'selected') {
    const parsed = parseUserIds(body.userIds);
    if (parsed.error) return { status: HTTP_STATUS.BAD_REQUEST, error: parsed.error };
    userIds = parsed.ids;
    const preview = await User.find(buildAudienceFilter('selected', userIds))
      .select('firstName lastName email')
      .limit(3)
      .lean();
    recipientPreview = preview.map(displayName);
  }

  const counts = await countAudience(audience, userIds);
  if (counts.totalUsers === 0) {
    return { status: HTTP_STATUS.BAD_REQUEST, error: 'No active users match these recipients' };
  }

  return {
    fields: {
      title: msg.title,
      body: msg.body,
      audience,
      userIds,
      recipientPreview,
      data: pushData.data,
      saveToInbox: body.saveToInbox !== false,
      ...timing.schedule,
    },
    counts,
  };
};

const loadSchedule = async (id) => {
  if (!isValidObjectId(id))
    return { status: HTTP_STATUS.BAD_REQUEST, error: 'Invalid schedule id' };
  const schedule = await PushSchedule.findById(id);
  if (!schedule) return { status: HTTP_STATUS.NOT_FOUND, error: 'Schedule not found' };
  return { schedule };
};

const scheduleResponse = async (id) => {
  const schedule = await PushSchedule.findById(id)
    .select(SCHEDULE_HIDDEN_FIELDS)
    .populate('createdBy', 'firstName lastName email')
    .lean();
  return withDescription(schedule);
};

/**
 * POST /api/admin/notifications/schedules — send a push later, once or on
 * repeat. Body: the same message/recipient fields as a broadcast, plus
 * { startAt, repeat: none|daily|weekly|monthly, interval?, daysOfWeek?,
 * endAt?, maxRuns? } (see utils/pushSchedule.js; wall-clock rules are IST).
 */
export const createSchedule = async (req, res, next) => {
  try {
    if (!isFcmReady()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Push notifications are not configured',
      );
    }
    // A repeating schedule approved after its first slot simply starts at the
    // next one; a one-time send approved too late is refused instead.
    const built = await buildScheduleFields(req.body || {}, {
      allowPastStart: req.method === 'REPLAY' && (req.body?.repeat ?? 'none') !== 'none',
    });
    if (built.error) return sendError(res, built.status, built.error);

    const nextRunAt = firstRunFrom(built.fields, 0, new Date());
    if (!nextRunAt) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'These settings never send anything');
    }

    const schedule = await PushSchedule.create({
      ...built.fields,
      nextRunAt,
      createdBy: req.userId,
      updatedBy: req.userId,
    });

    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_SCHEDULE_CREATED,
      resourceType: 'push_schedule',
      resourceId: schedule._id,
      metadata: {
        title: schedule.title,
        audience: schedule.audience,
        when: describeSchedule(schedule),
        ...built.counts,
      },
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Push scheduled', {
      schedule: await scheduleResponse(schedule._id),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/notifications/schedules?status=&page=&limit= — newest first. */
export const listSchedules = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const filter = {};
    if (typeof req.query.status === 'string' && req.query.status) {
      filter.status = { $in: req.query.status.split(',') };
    }
    const [schedules, total] = await Promise.all([
      PushSchedule.find(filter)
        .select(SCHEDULE_HIDDEN_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('createdBy', 'firstName lastName email')
        .lean(),
      PushSchedule.countDocuments(filter),
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Schedules fetched', {
      schedules: schedules.map(withDescription),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/notifications/schedules/:id — one schedule plus its recent sends. */
export const getSchedule = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid schedule id');
    }
    const schedule = await PushSchedule.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email')
      .lean();
    if (!schedule) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Schedule not found');
    const { userIds, ...rest } = schedule;
    const [recentSends, recipients] = await Promise.all([
      PushBroadcast.find({ scheduleId: schedule._id })
        .select(HIDDEN_FIELDS)
        .sort({ createdAt: -1 })
        .limit(10)
        .lean(),
      // So the editor can prefill "specific people" for a hand-picked send.
      rest.audience === 'selected' && userIds?.length
        ? User.find(buildAudienceFilter('selected', userIds)).select(RECIPIENT_FIELDS).lean()
        : [],
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Schedule fetched', {
      schedule: withDescription(rest),
      recentSends,
      recipients: recipients.map(toRecipient),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PUT /api/admin/notifications/schedules/:id — replace the message,
 * recipients and timing of an active or paused schedule. Sends already made
 * still count toward `maxRuns`.
 */
export const updateSchedule = async (req, res, next) => {
  try {
    const loaded = await loadSchedule(req.params.id);
    if (loaded.error) return sendError(res, loaded.status, loaded.error);
    const { schedule } = loaded;
    if (!['active', 'paused'].includes(schedule.status)) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'Only an active or paused schedule can be edited',
      );
    }

    // Keeping the original start (already in the past for a running series)
    // is fine; moving it somewhere in the past is not.
    const keepsStart =
      new Date(req.body?.startAt).getTime() === new Date(schedule.startAt).getTime();
    const built = await buildScheduleFields(req.body || {}, {
      allowPastStart: keepsStart || req.method === 'REPLAY',
    });
    if (built.error) return sendError(res, built.status, built.error);

    const nextRunAt = firstRunFrom(built.fields, schedule.runCount, new Date());
    if (!nextRunAt) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'With these settings nothing is left to send');
    }

    const updated = await PushSchedule.findOneAndUpdate(
      { _id: schedule._id, status: { $in: ['active', 'paused'] }, updatedAt: schedule.updatedAt },
      {
        $set: {
          ...built.fields,
          userIds: built.fields.userIds ?? null,
          recipientPreview: built.fields.recipientPreview ?? null,
          data: built.fields.data ?? null,
          daysOfWeek: built.fields.daysOfWeek ?? null,
          nextRunAt,
          lastError: null,
          updatedBy: req.userId,
        },
      },
      { new: true },
    );
    if (!updated) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'This schedule changed while you were editing it — reload and try again',
      );
    }

    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_SCHEDULE_UPDATED,
      resourceType: 'push_schedule',
      resourceId: updated._id,
      metadata: {
        title: updated.title,
        audience: updated.audience,
        when: describeSchedule(updated),
      },
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Schedule updated', {
      schedule: await scheduleResponse(updated._id),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/notifications/schedules/:id/pause — stop sending until resumed. */
export const pauseSchedule = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid schedule id');
    }
    const schedule = await PushSchedule.findOneAndUpdate(
      { _id: req.params.id, status: 'active' },
      { $set: { status: 'paused', updatedBy: req.userId } },
      { new: true },
    );
    if (!schedule) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'Only an active schedule can be paused');
    }
    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_SCHEDULE_PAUSED,
      resourceType: 'push_schedule',
      resourceId: schedule._id,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Schedule paused', {
      schedule: await scheduleResponse(schedule._id),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/notifications/schedules/:id/resume — continue from the next
 * occurrence after now; sends missed while paused are not made up.
 */
export const resumeSchedule = async (req, res, next) => {
  try {
    const loaded = await loadSchedule(req.params.id);
    if (loaded.error) return sendError(res, loaded.status, loaded.error);
    const { schedule } = loaded;
    if (schedule.status !== 'paused') {
      return sendError(res, HTTP_STATUS.CONFLICT, 'Only a paused schedule can be resumed');
    }

    const nextRunAt = firstRunFrom(schedule.toObject(), schedule.runCount, new Date());
    if (!nextRunAt) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'Nothing is left to send on this schedule — edit its timing first',
      );
    }

    const resumed = await PushSchedule.findOneAndUpdate(
      { _id: schedule._id, status: 'paused' },
      { $set: { status: 'active', nextRunAt, lastError: null, updatedBy: req.userId } },
      { new: true },
    );
    if (!resumed) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'Only a paused schedule can be resumed');
    }

    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_SCHEDULE_RESUMED,
      resourceType: 'push_schedule',
      resourceId: resumed._id,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Schedule resumed', {
      schedule: await scheduleResponse(resumed._id),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/notifications/schedules/:id — cancel for good. The record
 * stays for history; a send already in progress is not stopped (cancel that
 * broadcast separately).
 */
export const cancelSchedule = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid schedule id');
    }
    const schedule = await PushSchedule.findOneAndUpdate(
      { _id: req.params.id, status: { $in: ['active', 'paused'] } },
      { $set: { status: 'cancelled', nextRunAt: null, updatedBy: req.userId } },
      { new: true },
    );
    if (!schedule) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'Only an active or paused schedule can be cancelled',
      );
    }
    recordAudit({
      req,
      action: AUDIT_ACTIONS.PUSH_SCHEDULE_CANCELLED,
      resourceType: 'push_schedule',
      resourceId: schedule._id,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Schedule cancelled', {
      schedule: await scheduleResponse(schedule._id),
    });
  } catch (error) {
    next(error);
  }
};
