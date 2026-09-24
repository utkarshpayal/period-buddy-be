import { verifyToken } from '../utils/jwt.js';
import { ERROR_MESSAGES } from '../constants/errorMessages.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { sendError } from '../utils/sendResponse.js';
import User from '../models/User.js';
import logger from '../utils/logger.js';

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
    // Both branches below return the same generic message to the client
    // (never leak *why* a token was rejected over the wire), but nothing was
    // logged server-side either way — making "Invalid or expired token"
    // impossible to tell apart from a bad signature, a malformed token, a
    // wrong-secret token, or a valid-but-userId-doesn't-cast CastError just
    // by looking at the response. Log the real reason (never the token
    // itself) so this is diagnosable from the server logs.
    logger.warn('auth_token_rejected', {
      action: 'auth_token_rejected',
      reason: error.message,
      path: req.originalUrl,
    });
    if (error.message === 'Token expired') {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.TOKEN_EXPIRED);
    }
    return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.INVALID_TOKEN);
  }
};

export const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return sendError(
        res,
        HTTP_STATUS.FORBIDDEN,
        'You do not have permission to perform this action',
      );
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
  } catch {
    // Continue without authentication if token is invalid
    next();
  }
};
