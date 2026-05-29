import { HTTP_STATUS } from '../constants/httpStatus.js';
import { ERROR_MESSAGES } from '../constants/errorMessages.js';

export const errorHandler = (err, req, res, next) => {
  console.error('Error:', err);

  // Mongoose validation error
  if (err.name === 'ValidationError') {
    const messages = Object.values(err.errors).map((error) => error.message);
    return res.status(HTTP_STATUS.UNPROCESSABLE_ENTITY).json({
      success: false,
      statusCode: HTTP_STATUS.UNPROCESSABLE_ENTITY,
      message: 'Validation Error',
      errors: messages,
    });
  }

  // Mongoose duplicate key error
  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern)[0];
    return res.status(HTTP_STATUS.CONFLICT).json({
      success: false,
      statusCode: HTTP_STATUS.CONFLICT,
      message: `${field} already exists`,
    });
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      message: ERROR_MESSAGES.INVALID_TOKEN,
    });
  }

  if (err.name === 'TokenExpiredError') {
    return res.status(HTTP_STATUS.UNAUTHORIZED).json({
      success: false,
      statusCode: HTTP_STATUS.UNAUTHORIZED,
      message: ERROR_MESSAGES.TOKEN_EXPIRED,
    });
  }

  // Default error
  res.status(err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR).json({
    success: false,
    statusCode: err.statusCode || HTTP_STATUS.INTERNAL_SERVER_ERROR,
    message: err.message || ERROR_MESSAGES.INTERNAL_SERVER_ERROR,
  });
};

export const notFound = (req, res) => {
  res.status(HTTP_STATUS.NOT_FOUND).json({
    success: false,
    statusCode: HTTP_STATUS.NOT_FOUND,
    message: 'Route not found',
  });
};
