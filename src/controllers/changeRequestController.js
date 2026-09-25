import ChangeRequest from '../models/ChangeRequest.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { isValidObjectId, getPagination, buildPagination } from '../utils/apiHelpers.js';
import { replayChangeRequest } from '../middleware/approvalGate.js';
import {
  APPROVE_PERMISSION_BY_DEPARTMENT,
  canApproveDepartment,
  hasPermission,
} from '../config/permissions.js';
import logger from '../utils/logger.js';

const PEOPLE_FIELDS = 'firstName lastName email role';

/** Departments whose queue the caller reviews. */
const reviewableDepartments = (role) =>
  Object.entries(APPROVE_PERMISSION_BY_DEPARTMENT)
    .filter(([, permission]) => hasPermission(role, permission))
    .map(([department]) => department);

const canView = (req, request) =>
  String(request.requestedBy?._id ?? request.requestedBy) === String(req.userId) ||
  canApproveDepartment(req.user.role, request.department);

const loadRequest = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid request id');
    return null;
  }
  const request = await ChangeRequest.findById(req.params.id)
    .populate('requestedBy', PEOPLE_FIELDS)
    .populate('reviewedBy', PEOPLE_FIELDS);
  if (!request || !canView(req, request)) {
    sendError(res, HTTP_STATUS.NOT_FOUND, 'Request not found');
    return null;
  }
  return request;
};

/**
 * GET /api/admin/change-requests
 * Query: ?scope=review|mine (default: review if the caller approves anything)
 *        &status=pending|approved|rejected|cancelled|all &department= &page= &limit=
 */
export const listChangeRequests = async (req, res, next) => {
  try {
    const departments = reviewableDepartments(req.user.role);
    const scope = req.query.scope === 'mine' || departments.length === 0 ? 'mine' : 'review';

    const filter =
      scope === 'mine'
        ? { requestedBy: req.userId }
        : {
            department: {
              $in:
                req.query.department && departments.includes(req.query.department)
                  ? [req.query.department]
                  : departments,
            },
          };
    const status = req.query.status || 'pending';
    if (status !== 'all') filter.status = status;
    if (req.query.resourceType) filter.resourceType = String(req.query.resourceType);
    if (req.query.resourceId) filter.resourceId = String(req.query.resourceId);

    const { page, limit, skip } = getPagination(req.query);
    const [items, total] = await Promise.all([
      ChangeRequest.find(filter)
        .populate('requestedBy', PEOPLE_FIELDS)
        .populate('reviewedBy', PEOPLE_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ChangeRequest.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Requests loaded', {
      scope,
      requests: items,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/change-requests/summary — badge counts for the sidebar. */
export const getChangeRequestSummary = async (req, res, next) => {
  try {
    const departments = reviewableDepartments(req.user.role);
    const [toReview, minePending] = await Promise.all([
      departments.length
        ? ChangeRequest.countDocuments({ department: { $in: departments }, status: 'pending' })
        : 0,
      ChangeRequest.countDocuments({ requestedBy: req.userId, status: 'pending' }),
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Summary loaded', { toReview, minePending });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/change-requests/:id */
export const getChangeRequest = async (req, res, next) => {
  try {
    const request = await loadRequest(req, res);
    if (!request) return;
    return sendResponse(res, HTTP_STATUS.OK, 'Request loaded', request);
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/change-requests/:id/approve — { note? } */
export const approveChangeRequest = async (req, res, next) => {
  try {
    const request = await loadRequest(req, res);
    if (!request) return;
    if (!canApproveDepartment(req.user.role, request.department)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You cannot approve this request');
    }
    if (String(request.requestedBy?._id) === String(req.userId)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You cannot approve your own request');
    }

    // Claim it atomically so two approvers can't apply the same change twice.
    const claimed = await ChangeRequest.findOneAndUpdate(
      { _id: request._id, status: 'pending' },
      {
        status: 'approved',
        reviewedBy: req.userId,
        reviewedAt: new Date(),
        reviewNote: req.body?.note,
      },
      { new: true },
    );
    if (!claimed) {
      return sendError(res, HTTP_STATUS.CONFLICT, `This request is already ${request.status}`);
    }

    let outcome;
    try {
      outcome = await replayChangeRequest(claimed, req);
    } catch (error) {
      outcome = { ok: false, statusCode: 500, body: { message: error.message } };
    }

    if (!outcome.ok) {
      // Put it back so the reviewer can reject it (or retry after a fix).
      await ChangeRequest.updateOne(
        { _id: claimed._id },
        { status: 'pending', $unset: { reviewedBy: 1, reviewedAt: 1, reviewNote: 1 } },
      );
      logger.warn('change_request_apply_failed', {
        action: 'change_request_apply_failed',
        requestId: String(claimed._id),
        key: claimed.key,
        statusCode: outcome.statusCode,
        reason: outcome.body?.message,
      });
      return sendError(
        res,
        outcome.statusCode >= 500
          ? HTTP_STATUS.INTERNAL_SERVER_ERROR
          : HTTP_STATUS.UNPROCESSABLE_ENTITY,
        `Could not apply this change: ${outcome.body?.message || 'unknown error'}`,
      );
    }

    claimed.result = { statusCode: outcome.statusCode, message: outcome.body?.message };
    await claimed.save();
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.CHANGE_REQUEST_APPROVED,
      resourceType: 'change_request',
      resourceId: String(claimed._id),
      metadata: {
        key: claimed.key,
        targetType: claimed.resourceType,
        targetId: claimed.resourceId,
      },
    });

    await claimed.populate('requestedBy', PEOPLE_FIELDS);
    await claimed.populate('reviewedBy', PEOPLE_FIELDS);
    return sendResponse(res, HTTP_STATUS.OK, 'Approved and applied', claimed);
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/change-requests/:id/reject — { note } */
export const rejectChangeRequest = async (req, res, next) => {
  try {
    const request = await loadRequest(req, res);
    if (!request) return;
    if (!canApproveDepartment(req.user.role, request.department)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You cannot review this request');
    }
    const note = String(req.body?.note || '').trim();
    if (!note) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Add a short note explaining the rejection');
    }

    const updated = await ChangeRequest.findOneAndUpdate(
      { _id: request._id, status: 'pending' },
      { status: 'rejected', reviewedBy: req.userId, reviewedAt: new Date(), reviewNote: note },
      { new: true },
    )
      .populate('requestedBy', PEOPLE_FIELDS)
      .populate('reviewedBy', PEOPLE_FIELDS);
    if (!updated) {
      return sendError(res, HTTP_STATUS.CONFLICT, `This request is already ${request.status}`);
    }

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.CHANGE_REQUEST_REJECTED,
      resourceType: 'change_request',
      resourceId: String(updated._id),
      metadata: { key: updated.key },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Request rejected', updated);
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/change-requests/:id/cancel — requester withdraws it. */
export const cancelChangeRequest = async (req, res, next) => {
  try {
    const request = await loadRequest(req, res);
    if (!request) return;
    if (String(request.requestedBy?._id) !== String(req.userId)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Only the requester can withdraw a request');
    }

    const updated = await ChangeRequest.findOneAndUpdate(
      { _id: request._id, status: 'pending' },
      { status: 'cancelled', reviewedAt: new Date() },
      { new: true },
    ).populate('requestedBy', PEOPLE_FIELDS);
    if (!updated) {
      return sendError(res, HTTP_STATUS.CONFLICT, `This request is already ${request.status}`);
    }

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.CHANGE_REQUEST_CANCELLED,
      resourceType: 'change_request',
      resourceId: String(updated._id),
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Request withdrawn', updated);
  } catch (error) {
    next(error);
  }
};
