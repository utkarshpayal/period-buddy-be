import { SESSION_REVOKED, resolveToken } from '../utils/sessions.js';
import { ERROR_MESSAGES } from '../constants/errorMessages.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { sendError } from '../utils/sendResponse.js';
import logger from '../utils/logger.js';
import { isSuspended, sendAccountSuspendedError } from '../utils/accountStatus.js';
import { cookieRequestAllowed, tokenFromRequest } from '../utils/sessionCookie.js';
import { CALL_TOKEN_SCOPE } from '../utils/samvaadClient.js';

/**
 * Whether a token's `scope` lets it make this request. Normal sign-in tokens
 * have none. The check-in call token (utils/samvaadClient.js) may only log
 * the day's cycle data; any other scope is refused everywhere.
 */
export const scopeAllows = (scope, req) => {
  if (!scope) return true;
  return (
    scope === CALL_TOKEN_SCOPE &&
    req.method === 'POST' &&
    (req.baseUrl + req.path).replace(/\/$/, '') === '/api/cycle/log'
  );
};

export const authenticate = async (req, res, next) => {
  try {
    // Bearer header, or the staff session cookie (utils/sessionCookie.js).
    const { token, fromCookie } = tokenFromRequest(req);

    if (!token) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.NO_TOKEN);
    }
    if (fromCookie && !cookieRequestAllowed(req)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Request blocked: unknown origin');
    }

    const { user, decoded, session } = await resolveToken(token);

    // Suspended while already signed in: still a 401 (so clients sign out as
    // before), but with code ACCOUNT_SUSPENDED so they can say why.
    if (isSuspended(user)) {
      return sendAccountSuspendedError(res, HTTP_STATUS.UNAUTHORIZED);
    }
    if (!user || !user.isActive) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.USER_NOT_FOUND);
    }

    // Scoped tokens (check-in call tokens handed to the call provider) work
    // only for the one endpoint they're for.
    if (!scopeAllows(decoded.scope, req)) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.INVALID_TOKEN);
    }

    req.user = user;
    req.userId = decoded.userId;
    req.session = session;
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
    if (error.message === SESSION_REVOKED) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, ERROR_MESSAGES.SESSION_REVOKED);
    }
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
    const { token, fromCookie } = tokenFromRequest(req);

    if (token && (!fromCookie || cookieRequestAllowed(req))) {
      const { user, decoded, session } = await resolveToken(token);
      if (user && user.isActive && !decoded.scope) {
        req.user = user;
        req.userId = decoded.userId;
        req.session = session;
      }
    }
    next();
  } catch {
    // Continue without authentication if token is invalid
    next();
  }
};
