import logger from '../utils/logger.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';

export const notFound = (req, res, next) => {
  const error = new Error(`Not found - ${req.originalUrl}`);
  res.status(HTTP_STATUS.NOT_FOUND);
  next(error);
};

export const errorHandler = (err, req, res, _next) => {
  let statusCode =
    err.statusCode || (res.statusCode !== 200 ? res.statusCode : HTTP_STATUS.INTERNAL_SERVER_ERROR);

  // Log the error with context
  logger.error('http_error', {
    action: 'http_error',
    statusCode,
    method: req.method,
    url: req.originalUrl,
    userId: req.userId || null,
    errorMessage: err.message,
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined,
  });

  // Mongoose validation errors
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((e) => e.message);
    return res.status(400).json({
      success: false,
      statusCode: HTTP_STATUS.BAD_REQUEST,
      message: 'Validation Error',
      errors: messages,
    });
  }

  if (err.name === 'CastError') {
    statusCode = HTTP_STATUS.BAD_REQUEST;
    return res.status(statusCode).json({
      success: false,
      statusCode,
      message: `Invalid ${err.path || 'identifier'}`,
    });
  }

  // Mongoose duplicate key
  if (err.code === 11000) {
    const field = Object.keys(err.keyValue || {})[0];
    return res.status(409).json({
      success: false,
      statusCode: HTTP_STATUS.CONFLICT,
      message: `${field ? `${field} already exists` : 'Duplicate entry'}`,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res
      .status(401)
      .json({ success: false, statusCode: HTTP_STATUS.UNAUTHORIZED, message: 'Invalid token' });
  }
  if (err.name === 'TokenExpiredError') {
    return res
      .status(401)
      .json({ success: false, statusCode: HTTP_STATUS.UNAUTHORIZED, message: 'Token expired' });
  }

  // For server-side (5xx) errors in production, never surface the raw error
  // message to the client — it can leak DB internals, file paths, or secrets
  // (e.g. "connect ECONNREFUSED 127.0.0.1:27017"). The real message is still
  // logged above. Intentional 4xx messages remain client-visible.
  const isServerError = statusCode >= HTTP_STATUS.INTERNAL_SERVER_ERROR;
  const safeMessage =
    isServerError && process.env.NODE_ENV === 'production'
      ? 'Internal Server Error'
      : err.message || 'Internal Server Error';

  return res.status(statusCode).json({
    success: false,
    statusCode,
    message: safeMessage,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
  });
};
