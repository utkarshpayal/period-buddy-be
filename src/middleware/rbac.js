import { hasAnyPermission, isStaffRole } from '../config/permissions.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { sendError } from '../utils/sendResponse.js';

/**
 * Allow the request when the authenticated user holds ANY of `permissions`
 * (see config/permissions.js). Must run after `authenticate`.
 */
export const requirePermission = (...permissions) => {
  const middleware = (req, res, next) => {
    if (!req.user || !hasAnyPermission(req.user.role, permissions)) {
      return sendError(
        res,
        HTTP_STATUS.FORBIDDEN,
        'You do not have permission to perform this action',
      );
    }
    next();
  };
  // The name carries the permissions so scripts/generateSwaggerSpec.js can
  // document what each route requires (it reads middleware by name).
  Object.defineProperty(middleware, 'name', {
    value: `requirePermission:${permissions.join(',')}`,
  });
  return middleware;
};

/** Any signed-in Admin Workspace staff member (see config/permissions.js). */
export const requireStaff = (req, res, next) => {
  if (!req.user || !isStaffRole(req.user.role)) {
    return sendError(
      res,
      HTTP_STATUS.FORBIDDEN,
      'You do not have permission to perform this action',
    );
  }
  next();
};
