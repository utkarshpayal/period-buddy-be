import { verifyToken } from '../utils/jwt.js';
import { ERROR_MESSAGES } from '../constants/errorMessages.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { sendError } from '../utils/sendResponse.js';
import User from '../models/User.js';

export const authenticate = async (req, res, next) => {
  try {
    const [scheme, token] = req.headers.authorization?.split(' ') || [];

    if (scheme !== 'Bearer' || !token) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.NO_TOKEN);
    }

    const decoded = verifyToken(token);
    const user = await User.findById(decoded.userId);

    if (!user || !user.isActive) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    req.user = user;
    req.userId = decoded.userId;
    next();
  } catch (error) {
    if (error.message === 'Token expired') {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.TOKEN_EXPIRED);
    }
    return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.INVALID_TOKEN);
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You do not have permission to perform this action');
    }
    next();
  };
};

export const optionalAuth = async (req, res, next) => {
  try {
    const [scheme, token] = req.headers.authorization?.split(' ') || [];

    if (scheme === 'Bearer' && token) {
      const decoded = verifyToken(token);
      const user = await User.findById(decoded.userId);
      if (user && user.isActive) {
        req.user = user;
        req.userId = decoded.userId;
      }
    }
    next();
  } catch (error) {
    // Continue without authentication if token is invalid
    next();
  }
};
