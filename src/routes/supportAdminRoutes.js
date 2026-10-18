import express from 'express';
import * as supportController from '../controllers/supportController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission, requireStaff } from '../middleware/rbac.js';
import { PERMISSIONS as P } from '../config/permissions.js';

// Admin Workspace ticket management for Help & support tickets.
const router = express.Router();
router.use(authenticate, requireStaff);

/**
 * @route   GET /api/admin/support/tickets
 * @desc    All tickets, latest activity first. ?status= (one, comma list or 'active') &priority= &category= &assignee=<id|me|none> &search= (ticket number or the person's name/email) &page= &limit=. Also returns statusCounts
 * @access  Admin (support.read)
 */
router.get('/tickets', requirePermission(P.SUPPORT_READ), supportController.adminListTickets);

/**
 * @route   GET /api/admin/support/assignees
 * @desc    Active staff who hold support access, for the assignee picker
 * @access  Admin (support.read)
 */
router.get('/assignees', requirePermission(P.SUPPORT_READ), supportController.adminListAssignees);

/**
 * @route   GET /api/admin/support/tickets/:id
 * @desc    One ticket with the person's details, device info and the full thread
 * @access  Admin (support.read)
 */
router.get('/tickets/:id', requirePermission(P.SUPPORT_READ), supportController.adminGetTicket);

/**
 * @route   PATCH /api/admin/support/tickets/:id
 * @desc    Change status, priority and/or assignee. Body: { status?, priority?, assignee? (staff id or null) }. Resolving/closing notifies the person
 * @access  Admin (support.manage)
 */
router.patch(
  '/tickets/:id',
  requirePermission(P.SUPPORT_MANAGE),
  supportController.adminUpdateTicket,
);

/**
 * @route   POST /api/admin/support/tickets/:id/reply
 * @desc    Reply to the person. Body: { message, status? }. Sends an in-app notification + push that opens the ticket
 * @access  Admin (support.manage)
 */
router.post(
  '/tickets/:id/reply',
  requirePermission(P.SUPPORT_MANAGE),
  supportController.adminReplyToTicket,
);

export default router;
