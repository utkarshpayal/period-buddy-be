import { hasAnyPermission } from '../config/permissions.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { sendError } from '../utils/sendResponse.js';

/**
 * Allow the request when the authenticated user holds ANY of `permissions`
 * (see config/permissions.js). Must run after `authenticate`.
 */
export const requirePermission = (...permissions) => {
  return (req, res, next) => {
    if (!req.user || !hasAnyPermission(req.user.role, permissions)) {
      return sendError(
        res,
        HTTP_STATUS.FORBIDDEN,
        'You do not have permission to perform this action',
      );
    }
    next();
  };
};
