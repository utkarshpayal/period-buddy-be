import { body, validationResult } from 'express-validator';
import { ERROR_MESSAGES } from '../constants/errorMessages.js';

export const validateNewsletterSubscribe = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage(ERROR_MESSAGES.INVALID_EMAIL)
    .normalizeEmail({ gmail_remove_dots: false }),
];

export const validateContactMessage = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Name is required')
    .isLength({ min: 2, max: 100 })
    .withMessage('Name must be between 2 and 100 characters'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage(ERROR_MESSAGES.INVALID_EMAIL)
    .normalizeEmail({ gmail_remove_dots: false }),

  body('topic')
    .optional()
    .trim()
    .isIn([
      'General question',
      'Privacy & data',
      'Bug report',
      'Partnership / press',
      'Billing (Nura Plus)',
    ])
    .withMessage('Invalid topic'),

  body('message')
    .trim()
    .notEmpty()
    .withMessage('Message is required')
    .isLength({ min: 10, max: 3000 })
    .withMessage('Message must be between 10 and 3000 characters'),
];

export const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(422).json({
      success: false,
      statusCode: 422,
      message: 'Validation failed',
      errors: errors.array().map((error) => ({
        field: error.path || error.param,
        message: error.msg,
      })),
    });
  }
  next();
};
