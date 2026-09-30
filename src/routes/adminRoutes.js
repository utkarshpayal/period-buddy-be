import * as twoFactorController from '../controllers/twoFactorController.js';
import express from 'express';
import multer from 'multer';
import User from '../models/User.js';
import PushSchedule from '../models/PushSchedule.js';
import * as adminController from '../controllers/adminController.js';
import * as adminNotificationController from '../controllers/adminNotificationController.js';
import * as staffController from '../controllers/staffController.js';
import * as changeRequestController from '../controllers/changeRequestController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission, requireStaff } from '../middleware/rbac.js';
import { withApproval } from '../middleware/approvalGate.js';
import { PERMISSIONS as P, DEPARTMENTS } from '../config/permissions.js';

const router = express.Router();

// Every route here needs a signed-in staff member; each one then checks the
// specific permission it needs (config/permissions.js).
router.use(authenticate, requireStaff);

/* ------------------------------ Workspace ------------------------------ */

/**
 * @route   GET /api/admin/me
 * @desc    The signed-in staff member's role, department and permissions
 * @access  Private (any staff role)
 */
router.get('/me', staffController.getMyAccess);

/* ------------------------------ Analytics ------------------------------ */

router.get('/analytics', requirePermission(P.ANALYTICS_READ), adminController.getAnalytics);

/* -------------------------------- Users -------------------------------- */

router.get('/users', requirePermission(P.USERS_READ), adminController.listUsers);
router.get('/users/:id', requirePermission(P.USERS_READ), adminController.getUser);
router.patch(
  '/users/:id/status',
  requirePermission(P.USERS_READ),
  withApproval(
    {
      key: 'users.status',
      directPermission: P.USERS_MANAGE,
      department: DEPARTMENTS.APP,
      action: 'user_status',
      resourceType: 'user',
      snapshot: async (req) =>
        (await User.findById(req.params.id)
          .select('firstName lastName email isActive role')
          .lean()
          .catch(() => null)) || undefined,
      summarize: (req, before) =>
        `${req.body?.isActive === false ? 'Suspend' : 'Reactivate'} ${before?.email || 'user'}`,
    },
    adminController.setUserStatus,
  ),
);

/* ------------------------- Push notifications -------------------------- */

// Pushes to a handful of hand-picked users go straight out; anything wider
// (a role, everyone, or a big selection) needs an App Super Admin.
const DIRECT_PUSH_MAX_RECIPIENTS = 25;
const isWidePush = ({ audience, userIds } = {}) =>
  audience !== 'selected' || !Array.isArray(userIds) || userIds.length > DIRECT_PUSH_MAX_RECIPIENTS;
const describeRecipients = ({ audience, userIds } = {}) =>
  audience === 'selected' ? `${userIds?.length ?? 0} selected users` : audience || 'everyone';

router.get(
  '/notifications/audience',
  requirePermission(P.PUSH_READ),
  adminNotificationController.getAudienceCount,
);
router.get(
  '/notifications/recipients',
  requirePermission(P.PUSH_READ),
  adminNotificationController.searchRecipients,
);
// FCM's notification image limit is 1MB, and JPEG/PNG/WebP render
// everywhere; anything bigger or exotic uploads fine but never shows.
const NOTIFICATION_IMAGE_MAX_BYTES = 1024 * 1024;
const NOTIFICATION_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const notificationImageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: NOTIFICATION_IMAGE_MAX_BYTES },
  fileFilter: (req, file, cb) =>
    NOTIFICATION_IMAGE_TYPES.includes(file.mimetype)
      ? cb(null, true)
      : cb(Object.assign(new Error('Use a JPG, PNG or WebP image'), { statusCode: 400 })),
});
// Multer errors would otherwise surface as a 500.
const acceptNotificationImage = (req, res, next) =>
  notificationImageUpload.single('file')(req, res, (err) => {
    if (!err) return next();
    const message =
      err.code === 'LIMIT_FILE_SIZE' ? 'Notification images must be 1 MB or smaller' : err.message;
    return res.status(400).json({ success: false, statusCode: 400, message });
  });

/**
 * @route   POST /api/admin/notifications/upload
 * @desc    Upload a push notification's big-picture image (multipart field "file"; JPG, PNG or WebP up to 1MB). Returns { url, key }
 * @access  Private (push.send)
 */
router.post(
  '/notifications/upload',
  requirePermission(P.PUSH_SEND),
  acceptNotificationImage,
  adminNotificationController.uploadNotificationImage,
);
router.post(
  '/notifications/test',
  requirePermission(P.PUSH_SEND),
  adminNotificationController.sendTestNotification,
);
router.get(
  '/notifications/broadcasts',
  requirePermission(P.PUSH_READ),
  adminNotificationController.listBroadcasts,
);
router.post(
  '/notifications/broadcasts',
  requirePermission(P.PUSH_SEND),
  withApproval(
    {
      key: 'push.broadcast',
      directPermission: P.PUSH_BROADCAST,
      department: DEPARTMENTS.APP,
      action: 'push_send',
      resourceType: 'push_broadcast',
      needsApproval: async (req) => isWidePush(req.body),
      summarize: (req) =>
        `Send push "${String(req.body?.title || '').slice(0, 80)}" to ${describeRecipients(req.body)}`,
    },
    adminNotificationController.createBroadcast,
  ),
);
router.get(
  '/notifications/broadcasts/:id',
  requirePermission(P.PUSH_READ),
  adminNotificationController.getBroadcast,
);
router.post(
  '/notifications/broadcasts/:id/cancel',
  requirePermission(P.PUSH_SEND),
  adminNotificationController.cancelBroadcast,
);
router.post(
  '/notifications/broadcasts/:id/retry',
  requirePermission(P.PUSH_BROADCAST),
  adminNotificationController.retryBroadcast,
);

// Scheduled / repeating pushes. Same approval rule as sending now: anything
// wider than a few hand-picked users needs push.broadcast. Pausing and
// cancelling only ever reduce what gets sent, so push.send is enough.
const loadScheduleTarget = (req) =>
  PushSchedule.findById(req.params.id)
    .select('title audience userIds')
    .lean()
    .catch(() => null);

/**
 * @route   GET /api/admin/notifications/schedules
 * @desc    Scheduled and repeating pushes, newest first. Query: status (comma-separated active|paused|completed|cancelled), page, limit
 * @access  Private (push.read)
 */
router.get(
  '/notifications/schedules',
  requirePermission(P.PUSH_READ),
  adminNotificationController.listSchedules,
);
/**
 * @route   POST /api/admin/notifications/schedules
 * @desc    Schedule a push for later, once or repeating. Body: broadcast fields plus { startAt, repeat: none|daily|weekly|monthly, interval?, daysOfWeek?, endAt?, maxRuns? } (IST wall-clock)
 * @access  Private (push.send; wider than 25 picked users needs push.broadcast or approval)
 */
router.post(
  '/notifications/schedules',
  requirePermission(P.PUSH_SEND),
  withApproval(
    {
      key: 'push.schedule.create',
      directPermission: P.PUSH_BROADCAST,
      department: DEPARTMENTS.APP,
      action: 'push_schedule',
      resourceType: 'push_schedule',
      needsApproval: async (req) => isWidePush(req.body),
      summarize: (req) =>
        `Schedule push "${String(req.body?.title || '').slice(0, 80)}" (${
          req.body?.repeat && req.body.repeat !== 'none' ? `repeats ${req.body.repeat}` : 'once'
        }) to ${describeRecipients(req.body)}`,
    },
    adminNotificationController.createSchedule,
  ),
);
/**
 * @route   GET /api/admin/notifications/schedules/:id
 * @desc    One schedule with its last 10 sends (and picked recipients for a hand-picked one)
 * @access  Private (push.read)
 */
router.get(
  '/notifications/schedules/:id',
  requirePermission(P.PUSH_READ),
  adminNotificationController.getSchedule,
);
/**
 * @route   PUT /api/admin/notifications/schedules/:id
 * @desc    Replace an active/paused schedule's message, recipients and timing (same body as create)
 * @access  Private (push.send; wider than 25 picked users needs push.broadcast or approval)
 */
router.put(
  '/notifications/schedules/:id',
  requirePermission(P.PUSH_SEND),
  withApproval(
    {
      key: 'push.schedule.update',
      directPermission: P.PUSH_BROADCAST,
      department: DEPARTMENTS.APP,
      action: 'push_schedule_update',
      resourceType: 'push_schedule',
      needsApproval: async (req) => isWidePush(req.body),
      snapshot: async (req) => (await loadScheduleTarget(req)) || undefined,
      summarize: (req) =>
        `Edit scheduled push "${String(req.body?.title || '').slice(0, 80)}" to ${describeRecipients(
          req.body,
        )}`,
    },
    adminNotificationController.updateSchedule,
  ),
);
/**
 * @route   POST /api/admin/notifications/schedules/:id/pause
 * @desc    Pause an active schedule
 * @access  Private (push.send)
 */
router.post(
  '/notifications/schedules/:id/pause',
  requirePermission(P.PUSH_SEND),
  adminNotificationController.pauseSchedule,
);
/**
 * @route   POST /api/admin/notifications/schedules/:id/resume
 * @desc    Resume a paused schedule from its next occurrence
 * @access  Private (push.send; a wide audience needs push.broadcast or approval)
 */
router.post(
  '/notifications/schedules/:id/resume',
  requirePermission(P.PUSH_SEND),
  withApproval(
    {
      key: 'push.schedule.resume',
      directPermission: P.PUSH_BROADCAST,
      department: DEPARTMENTS.APP,
      action: 'push_schedule_resume',
      resourceType: 'push_schedule',
      needsApproval: async (req) => isWidePush((await loadScheduleTarget(req)) || {}),
      summarize: () => 'Resume a scheduled push',
    },
    adminNotificationController.resumeSchedule,
  ),
);
/**
 * @route   DELETE /api/admin/notifications/schedules/:id
 * @desc    Cancel a schedule for good (kept for history)
 * @access  Private (push.send)
 */
router.delete(
  '/notifications/schedules/:id',
  requirePermission(P.PUSH_SEND),
  adminNotificationController.cancelSchedule,
);

/* ---------------------------- Staff & access --------------------------- */

/**
 * @route   GET /api/admin/staff
 * @desc    List the staff the caller can see (everyone for Super Admin, otherwise their own department) plus the roles they may assign. Query: search, role, status=active|invited|suspended
 * @access  Private (staff.manage)
 */
router.get('/staff', requirePermission(P.STAFF_MANAGE), staffController.listStaff);
/**
 * @route   POST /api/admin/staff/invite
 * @desc    Invite a staff member by email with a role the caller may assign. Body: { name, email, role }. Returns the staff row and a 48h inviteUrl
 * @access  Private (staff.manage)
 */
router.post('/staff/invite', requirePermission(P.STAFF_MANAGE), staffController.inviteStaff);
/**
 * @route   PATCH /api/admin/staff/:id/role
 * @desc    Change a staff member's role. Body: { role }. The last active Super Admin cannot be demoted
 * @access  Private (staff.manage)
 */
router.patch('/staff/:id/role', requirePermission(P.STAFF_MANAGE), staffController.changeStaffRole);
/**
 * @route   PATCH /api/admin/staff/:id/status
 * @desc    Suspend or restore a staff member. Body: { isActive }
 * @access  Private (staff.manage)
 */
router.patch(
  '/staff/:id/status',
  requirePermission(P.STAFF_MANAGE),
  staffController.setStaffStatus,
);
/**
 * @route   POST /api/admin/staff/:id/resend-invite
 * @desc    Re-send a pending invite with a fresh 48h link
 * @access  Private (staff.manage)
 */
router.post(
  '/staff/:id/resend-invite',
  requirePermission(P.STAFF_MANAGE),
  staffController.resendStaffInvite,
);
/**
 * @route   DELETE /api/admin/staff/:id
 * @desc    Revoke workspace access: the account becomes a deactivated regular user (audit trail kept)
 * @access  Private (staff.manage)
 */
router.delete('/staff/:id', requirePermission(P.STAFF_MANAGE), staffController.removeStaff);
/**
 * @route   POST /api/admin/staff/:id/reset-2fa
 * @desc    Turn off a staff member's authenticator app (lost phone and recovery codes); they get emailed codes again
 * @access  Private (staff.manage)
 */
router.post(
  '/staff/:id/reset-2fa',
  requirePermission(P.STAFF_MANAGE),
  twoFactorController.resetStaffTwoFactor,
);

/* ---------------------------- Change requests -------------------------- */

// Visibility is scoped inside the controller: approvers see their
// department's queue, everyone sees their own requests.
/**
 * @route   GET /api/admin/change-requests
 * @desc    List change requests. Query: scope=review|mine, status=pending|approved|rejected|cancelled|all, department, resourceType, resourceId, page, limit. Approvers see their department's queue; everyone sees their own
 * @access  Private (any staff role)
 */
router.get('/change-requests', changeRequestController.listChangeRequests);
/**
 * @route   GET /api/admin/change-requests/summary
 * @desc    Badge counts: { toReview, minePending }
 * @access  Private (any staff role)
 */
router.get('/change-requests/summary', changeRequestController.getChangeRequestSummary);
/**
 * @route   GET /api/admin/change-requests/:id
 * @desc    One change request, including the before-snapshot and proposed body
 * @access  Private (requester or department approver)
 */
router.get('/change-requests/:id', changeRequestController.getChangeRequest);
/**
 * @route   POST /api/admin/change-requests/:id/approve
 * @desc    Approve and apply a pending request by replaying it through its original controller. Body: { note? }. 409 if no longer pending; 422 if the change can no longer be applied (request stays pending)
 * @access  Private (department approver, not the requester)
 */
router.post('/change-requests/:id/approve', changeRequestController.approveChangeRequest);
/**
 * @route   POST /api/admin/change-requests/:id/reject
 * @desc    Reject a pending request. Body: { note } (required)
 * @access  Private (department approver)
 */
router.post('/change-requests/:id/reject', changeRequestController.rejectChangeRequest);
/**
 * @route   POST /api/admin/change-requests/:id/cancel
 * @desc    Withdraw your own pending request
 * @access  Private (requester)
 */
router.post('/change-requests/:id/cancel', changeRequestController.cancelChangeRequest);

export default router;
