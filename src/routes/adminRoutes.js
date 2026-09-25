import express from 'express';
import User from '../models/User.js';
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
