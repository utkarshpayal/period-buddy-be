import express from 'express';
import User from '../models/User.js';
import * as adminController from '../controllers/adminController.js';
import * as adminNotificationController from '../controllers/adminNotificationController.js';
import * as staffController from '../controllers/staffController.js';
import * as changeRequestController from '../controllers/changeRequestController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { withApproval } from '../middleware/approvalGate.js';
import { PERMISSIONS as P, DEPARTMENTS, isStaffRole } from '../config/permissions.js';

const router = express.Router();

// Every route here needs a signed-in staff member; each one then checks the
// specific permission it needs (config/permissions.js).
router.use(authenticate, (req, res, next) =>
  isStaffRole(req.user.role)
    ? next()
    : res.status(403).json({
        success: false,
        statusCode: 403,
        message: 'You do not have permission to perform this action',
      }),
);

/* ------------------------------ Workspace ------------------------------ */

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
      needsApproval: async (req) => {
        const { audience, userIds } = req.body || {};
        if (audience !== 'selected') return true;
        return !Array.isArray(userIds) || userIds.length > DIRECT_PUSH_MAX_RECIPIENTS;
      },
      summarize: (req) =>
        `Send push "${String(req.body?.title || '').slice(0, 80)}" to ${
          req.body?.audience === 'selected'
            ? `${req.body?.userIds?.length ?? 0} selected users`
            : req.body?.audience || 'everyone'
        }`,
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

/* ---------------------------- Staff & access --------------------------- */

router.get('/staff', requirePermission(P.STAFF_MANAGE), staffController.listStaff);
router.post('/staff/invite', requirePermission(P.STAFF_MANAGE), staffController.inviteStaff);
router.patch('/staff/:id/role', requirePermission(P.STAFF_MANAGE), staffController.changeStaffRole);
router.patch(
  '/staff/:id/status',
  requirePermission(P.STAFF_MANAGE),
  staffController.setStaffStatus,
);
router.post(
  '/staff/:id/resend-invite',
  requirePermission(P.STAFF_MANAGE),
  staffController.resendStaffInvite,
);
router.delete('/staff/:id', requirePermission(P.STAFF_MANAGE), staffController.removeStaff);

/* ---------------------------- Change requests -------------------------- */

// Visibility is scoped inside the controller: approvers see their
// department's queue, everyone sees their own requests.
router.get('/change-requests', changeRequestController.listChangeRequests);
router.get('/change-requests/summary', changeRequestController.getChangeRequestSummary);
router.get('/change-requests/:id', changeRequestController.getChangeRequest);
router.post('/change-requests/:id/approve', changeRequestController.approveChangeRequest);
router.post('/change-requests/:id/reject', changeRequestController.rejectChangeRequest);
router.post('/change-requests/:id/cancel', changeRequestController.cancelChangeRequest);

export default router;
