import AuditLog from '../models/AuditLog.js';
import { sendResponse } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { getPagination, buildPagination } from '../utils/apiHelpers.js';

/**
 * GET /api/audit-logs — Super Admin: inspect the audit trail.
 * Optional filters: ?action=, ?resourceType=, ?actorId=. Paginated + bounded.
 */
export const listAuditLogs = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 25, maxLimit: 100 });

    const filter = {};
    if (req.query.action) filter.action = req.query.action;
    if (req.query.resourceType) filter.resourceType = req.query.resourceType;
    if (req.query.actorId) filter.actorId = req.query.actorId;

    const [logs, total] = await Promise.all([
      AuditLog.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      AuditLog.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Audit logs fetched', {
      logs,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};
