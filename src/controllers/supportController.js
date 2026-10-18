import SupportTicket, { nextTicketNumber } from '../models/SupportTicket.js';
import User from '../models/User.js';
import Notification from '../models/Notification.js';
import { sendMail } from '../utils/mailer.js';
import {
  getSupportTicketAdminTemplate,
  getSupportTicketConfirmationTemplate,
} from '../templates/emailTemplates.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
} from '../utils/apiHelpers.js';
import { hasPermission, isStaffRole, PERMISSIONS, STAFF_ROLES } from '../config/permissions.js';
import {
  MAX_REPLIES,
  SUPPORT_CATEGORIES,
  TICKET_NUMBER_REGEX,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  categoryLabel,
  parseAdminUpdate,
  parseReplyInput,
  parseStatusFilter,
  parseTicketInput,
  previewOf,
  statusAfterReply,
  supportInbox,
  ticketRoute,
  userCanReply,
} from '../utils/supportTicket.js';

/** Most tickets one account can open per hour (on top of supportTicketLimiter). */
const HOURLY_TICKET_CAP = Number.parseInt(process.env.SUPPORT_TICKET_HOURLY_MAX, 10) || 5;

const displayName = (user) =>
  [user?.firstName, user?.lastName].filter(Boolean).join(' ') || 'Nura user';

/** What the app sees: no assignee, no staff author ids, no internal flags. */
const toUserTicket = (ticket, { full = false } = {}) => {
  const t = typeof ticket.toJSON === 'function' ? ticket.toJSON() : ticket;
  const base = {
    _id: t._id,
    ticketNumber: t.ticketNumber,
    category: t.category,
    categoryLabel: categoryLabel(t.category),
    subject: t.subject,
    status: t.status,
    lastReplyFrom: t.lastReplyFrom,
    lastActivityAt: t.lastActivityAt,
    unread: Boolean(t.userUnread),
    replyCount: t.replies?.length ?? 0,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
  if (!full) return { ...base, preview: previewOf(t.replies?.at(-1)?.message ?? t.message) };
  return {
    ...base,
    message: t.message,
    meta: t.meta && Object.keys(t.meta).length ? t.meta : null,
    canReply: userCanReply(t.status),
    replies: (t.replies || []).map((r) => ({
      _id: r._id,
      from: r.from,
      message: r.message,
      at: r.at,
    })),
  };
};

const notifyInbox = async ({ ticket, user, isReply, message }) => {
  const result = await sendMail({
    to: supportInbox(),
    replyTo: user?.email,
    subject: `[${ticket.ticketNumber}] ${isReply ? 'Reply: ' : ''}${categoryLabel(ticket.category)}`,
    html: getSupportTicketAdminTemplate({
      ticketNumber: ticket.ticketNumber,
      isReply,
      name: displayName(user),
      email: user?.email,
      category: categoryLabel(ticket.category),
      subject: ticket.subject,
      message,
      meta: isReply ? null : ticket.meta?.toObject?.() || null,
    }),
    text: `${isReply ? 'Reply on' : 'New support ticket'} ${ticket.ticketNumber}\n\nFrom: ${displayName(user)} <${user?.email || ''}>\nCategory: ${categoryLabel(ticket.category)}\nSubject: ${ticket.subject}\n\n${message}`,
  });
  return result.delivered;
};

/* ------------------------------- App user ------------------------------- */

/** GET /api/support/categories — the category chips. */
export const listCategories = (req, res) =>
  sendResponse(res, HTTP_STATUS.OK, 'Support categories', { categories: SUPPORT_CATEGORIES });

/** POST /api/support/tickets — open a ticket, email the support inbox and the person. */
export const createTicket = async (req, res, next) => {
  try {
    const { value, error } = parseTicketInput(req.body);
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);

    const since = new Date(Date.now() - 60 * 60 * 1000);
    const recent = await SupportTicket.countDocuments({
      userId: req.userId,
      createdAt: { $gte: since },
    });
    if (recent >= HOURLY_TICKET_CAP) {
      return sendError(
        res,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        "You've sent several requests in the last hour. Please add details to an existing ticket instead.",
      );
    }

    const ticketNumber = await nextTicketNumber();
    const meta = value.meta
      ? {
          ...value.meta,
          appVersion: value.meta.appVersion || req.get('X-App-Version') || undefined,
        }
      : undefined;
    const ticket = await SupportTicket.create({
      userId: req.userId,
      ticketNumber,
      category: value.category,
      subject: value.subject,
      message: value.message,
      meta,
      lastReplyFrom: 'user',
      lastActivityAt: new Date(),
    });

    const user = req.user;
    // Emails never fail the request: the ticket is saved and visible in the workspace.
    const [adminDelivered] = await Promise.all([
      notifyInbox({ ticket, user, isReply: false, message: value.message }).catch(() => false),
      user?.email
        ? sendMail({
            to: user.email,
            replyTo: supportInbox(),
            subject: `We got your message (${ticketNumber})`,
            html: getSupportTicketConfirmationTemplate({
              firstName: user.firstName,
              ticketNumber,
              subject: value.subject,
            }),
            text: `Hi ${user.firstName || 'there'},\n\nThanks for reaching out. Your request ${ticketNumber} is with our team. You'll get a notification in the Nura app when we reply.\n\nThe Nura Team`,
          }).catch(() => null)
        : null,
    ]);
    if (adminDelivered) {
      await SupportTicket.updateOne({ _id: ticket._id }, { adminEmailDelivered: true });
    }

    logger.info('support_ticket_created', {
      action: 'support_ticket_created',
      ticketId: String(ticket._id),
      ticketNumber,
      userId: String(req.userId),
      category: value.category,
      adminEmailDelivered: Boolean(adminDelivered),
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Ticket created', {
      ticket: toUserTicket(ticket, { full: true }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/support/tickets — the caller's tickets, newest activity first. */
export const listMyTickets = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 50 });
    const filter = { userId: req.userId };
    const statuses = parseStatusFilter(req.query.status);
    if (statuses) filter.status = { $in: statuses };

    const [tickets, total, unreadCount] = await Promise.all([
      SupportTicket.find(filter).sort({ lastActivityAt: -1 }).skip(skip).limit(limit).lean(),
      SupportTicket.countDocuments(filter),
      SupportTicket.countDocuments({ userId: req.userId, userUnread: true }),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Tickets fetched', {
      tickets: tickets.map((t) => toUserTicket(t)),
      unreadCount,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

const findOwnTicket = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    sendError(res, HTTP_STATUS.NOT_FOUND, 'Ticket not found');
    return null;
  }
  const ticket = await SupportTicket.findOne({ _id: req.params.id, userId: req.userId });
  if (!ticket) sendError(res, HTTP_STATUS.NOT_FOUND, 'Ticket not found');
  return ticket;
};

/** GET /api/support/tickets/:id — one ticket with its thread; marks staff replies read. */
export const getMyTicket = async (req, res, next) => {
  try {
    const ticket = await findOwnTicket(req, res);
    if (!ticket) return undefined;
    if (ticket.userUnread) {
      await SupportTicket.updateOne({ _id: ticket._id }, { userUnread: false });
      ticket.userUnread = false;
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Ticket fetched', {
      ticket: toUserTicket(ticket, { full: true }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/support/tickets/:id/reply — the person adds to their ticket. */
export const replyToMyTicket = async (req, res, next) => {
  try {
    const { value, error } = parseReplyInput(req.body);
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);
    const ticket = await findOwnTicket(req, res);
    if (!ticket) return undefined;
    if (!userCanReply(ticket.status)) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'This ticket is closed. Please open a new one if you still need help.',
      );
    }
    if (ticket.replies.length >= MAX_REPLIES) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'This ticket is full. Please open a new one.');
    }

    const now = new Date();
    ticket.replies.push({ from: 'user', message: value.message, at: now });
    const nextStatus = statusAfterReply(ticket.status, 'user');
    if (nextStatus !== ticket.status) {
      ticket.status = nextStatus;
      ticket.resolvedAt = null;
    }
    ticket.lastReplyFrom = 'user';
    ticket.lastActivityAt = now;
    await ticket.save();

    notifyInbox({ ticket, user: req.user, isReply: true, message: value.message }).catch(() => {});
    logger.info('support_ticket_user_reply', {
      action: 'support_ticket_user_reply',
      ticketId: String(ticket._id),
      userId: String(req.userId),
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Reply sent', {
      ticket: toUserTicket(ticket, { full: true }),
    });
  } catch (error) {
    next(error);
  }
};

/* --------------------------------- Admin -------------------------------- */

const USER_FIELDS = 'firstName lastName email phone role isActive deletedAt';
const STAFF_FIELDS = 'firstName lastName email role';

const toAdminTicket = (ticket, { full = false } = {}) => {
  const t = typeof ticket.toJSON === 'function' ? ticket.toJSON() : ticket;
  const base = {
    _id: t._id,
    ticketNumber: t.ticketNumber,
    category: t.category,
    categoryLabel: categoryLabel(t.category),
    subject: t.subject,
    status: t.status,
    priority: t.priority,
    user: t.userId && typeof t.userId === 'object' ? t.userId : { _id: t.userId },
    assignee: t.assignee || null,
    lastReplyFrom: t.lastReplyFrom,
    lastActivityAt: t.lastActivityAt,
    // The person replied last: staff owe an answer.
    awaitingStaff: t.lastReplyFrom === 'user' && ['open', 'in_progress'].includes(t.status),
    replyCount: t.replies?.length ?? 0,
    adminEmailDelivered: Boolean(t.adminEmailDelivered),
    createdAt: t.createdAt,
    resolvedAt: t.resolvedAt,
    closedAt: t.closedAt,
  };
  if (!full) return { ...base, preview: previewOf(t.replies?.at(-1)?.message ?? t.message) };
  return { ...base, message: t.message, meta: t.meta || null, replies: t.replies || [] };
};

/**
 * GET /api/admin/support/tickets — ?status= (one, comma list or 'active')
 * &priority= &category= &assignee=<id|me|none> &search= (ticket number or
 * the person's name/email; subject/message are encrypted) &page= &limit=
 */
export const adminListTickets = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const filter = {};
    const statuses = parseStatusFilter(req.query.status);
    if (statuses) filter.status = { $in: statuses };
    if (TICKET_PRIORITIES.includes(req.query.priority)) filter.priority = req.query.priority;
    if (SUPPORT_CATEGORIES.some((c) => c.id === req.query.category)) {
      filter.category = req.query.category;
    }
    const { assignee } = req.query;
    if (assignee === 'me') filter.assignee = req.userId;
    else if (assignee === 'none') filter.assignee = null;
    else if (isValidObjectId(assignee)) filter.assignee = assignee;

    const search =
      typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 100) : '';
    if (search) {
      if (TICKET_NUMBER_REGEX.test(search) || /^\d{1,9}$/.test(search)) {
        const digits = search.replace(/\D/g, '');
        filter.ticketNumber = new RegExp(`${escapeRegex(digits)}$`);
      } else {
        const rx = new RegExp(escapeRegex(search), 'i');
        const users = await User.find({ $or: [{ email: rx }, { firstName: rx }, { lastName: rx }] })
          .select('_id')
          .limit(500)
          .lean();
        filter.userId = { $in: users.map((u) => u._id) };
      }
    }

    const [tickets, total, counts] = await Promise.all([
      SupportTicket.find(filter)
        .sort({ lastActivityAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('userId', USER_FIELDS)
        .populate('assignee', STAFF_FIELDS)
        .lean(),
      SupportTicket.countDocuments(filter),
      SupportTicket.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
    ]);

    const statusCounts = Object.fromEntries(TICKET_STATUSES.map((s) => [s, 0]));
    for (const row of counts) if (row._id in statusCounts) statusCounts[row._id] = row.n;

    return sendResponse(res, HTTP_STATUS.OK, 'Tickets fetched', {
      tickets: tickets.map((t) => toAdminTicket(t)),
      statusCounts,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

const loadAdminTicket = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    sendError(res, HTTP_STATUS.NOT_FOUND, 'Ticket not found');
    return null;
  }
  const ticket = await SupportTicket.findById(req.params.id)
    .populate('userId', USER_FIELDS)
    .populate('assignee', STAFF_FIELDS)
    .populate('replies.authorId', STAFF_FIELDS);
  if (!ticket) sendError(res, HTTP_STATUS.NOT_FOUND, 'Ticket not found');
  return ticket;
};

/** GET /api/admin/support/tickets/:id */
export const adminGetTicket = async (req, res, next) => {
  try {
    const ticket = await loadAdminTicket(req, res);
    if (!ticket) return undefined;
    return sendResponse(res, HTTP_STATUS.OK, 'Ticket fetched', {
      ticket: toAdminTicket(ticket, { full: true }),
    });
  } catch (error) {
    next(error);
  }
};

const applyStatus = (ticket, status) => {
  if (status === ticket.status) return;
  ticket.status = status;
  const now = new Date();
  ticket.resolvedAt = status === 'resolved' ? now : status === 'closed' ? ticket.resolvedAt : null;
  ticket.closedAt = status === 'closed' ? now : null;
};

const STATUS_PUSH = {
  resolved: 'marked your request as resolved',
  closed: 'closed your request',
};

const notifyUser = (ticket, { title, body }) =>
  Notification.create({
    userId: ticket.userId?._id ?? ticket.userId,
    type: 'system',
    title,
    body,
    data: {
      kind: 'support_ticket',
      ticketId: String(ticket._id),
      route: ticketRoute(ticket._id),
    },
  }).catch((error) =>
    logger.error('support_ticket_notify_failed', {
      action: 'support_ticket_notify_failed',
      ticketId: String(ticket._id),
      error: error.message,
    }),
  );

/** PATCH /api/admin/support/tickets/:id — { status?, priority?, assignee? } */
export const adminUpdateTicket = async (req, res, next) => {
  try {
    const { value, error } = parseAdminUpdate(req.body);
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);

    if (value.assignee) {
      const staff = await User.findById(value.assignee).select('role isActive').lean();
      if (
        !staff ||
        !staff.isActive ||
        !isStaffRole(staff.role) ||
        !hasPermission(staff.role, PERMISSIONS.SUPPORT_READ)
      ) {
        return sendError(
          res,
          HTTP_STATUS.BAD_REQUEST,
          'Assignee must be a staff member with support access',
        );
      }
    }

    const ticket = await loadAdminTicket(req, res);
    if (!ticket) return undefined;
    const before = ticket.status;
    if (value.status) applyStatus(ticket, value.status);
    if (value.priority) ticket.priority = value.priority;
    if (value.assignee !== undefined) ticket.assignee = value.assignee;
    await ticket.save();
    await ticket.populate('assignee', STAFF_FIELDS);

    if (value.status && value.status !== before && STATUS_PUSH[value.status]) {
      notifyUser(ticket, {
        title: `Update on ${ticket.ticketNumber}`,
        body: `Nura support ${STATUS_PUSH[value.status]}.`,
      });
    }

    logger.info('support_ticket_updated', {
      action: 'support_ticket_updated',
      ticketId: String(ticket._id),
      by: String(req.userId),
      changes: Object.keys(value),
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Ticket updated', {
      ticket: toAdminTicket(ticket, { full: true }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/support/tickets/:id/reply — { message, status? }. Sends the
 * person an in-app notification + push that opens the ticket.
 */
export const adminReplyToTicket = async (req, res, next) => {
  try {
    const { value, error } = parseReplyInput(req.body);
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);
    let status;
    if (req.body.status !== undefined) {
      if (!TICKET_STATUSES.includes(req.body.status)) {
        return sendError(
          res,
          HTTP_STATUS.BAD_REQUEST,
          `status must be one of: ${TICKET_STATUSES.join(', ')}`,
        );
      }
      status = req.body.status;
    }

    const ticket = await loadAdminTicket(req, res);
    if (!ticket) return undefined;
    if (ticket.replies.length >= MAX_REPLIES) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'This ticket has reached its reply limit.');
    }

    const now = new Date();
    ticket.replies.push({ from: 'admin', authorId: req.userId, message: value.message, at: now });
    applyStatus(ticket, status ?? statusAfterReply(ticket.status, 'admin'));
    if (!ticket.assignee) ticket.assignee = req.userId;
    ticket.lastReplyFrom = 'admin';
    ticket.lastActivityAt = now;
    ticket.userUnread = true;
    await ticket.save();

    notifyUser(ticket, {
      title: `Nura support replied (${ticket.ticketNumber})`,
      body: previewOf(value.message, 120),
    });

    logger.info('support_ticket_admin_reply', {
      action: 'support_ticket_admin_reply',
      ticketId: String(ticket._id),
      by: String(req.userId),
      status: ticket.status,
    });

    await ticket.populate([
      { path: 'assignee', select: STAFF_FIELDS },
      { path: 'replies.authorId', select: STAFF_FIELDS },
    ]);
    return sendResponse(res, HTTP_STATUS.CREATED, 'Reply sent', {
      ticket: toAdminTicket(ticket, { full: true }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/support/assignees — staff who can be assigned tickets. */
export const adminListAssignees = async (req, res, next) => {
  try {
    const roles = Object.keys(STAFF_ROLES).filter((role) =>
      hasPermission(role, PERMISSIONS.SUPPORT_READ),
    );
    const staff = await User.find({ isActive: true, deletedAt: null, role: { $in: roles } })
      .select(STAFF_FIELDS)
      .sort({ firstName: 1 })
      .lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Assignees fetched', { assignees: staff });
  } catch (error) {
    next(error);
  }
};
