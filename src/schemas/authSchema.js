import { body, validationResult } from 'express-validator';
import { ERROR_MESSAGES } from '../constants/errorMessages.js';
import { validatePasswordStrength } from '../utils/password.js';

const normalizeProfilePicture = (value) => {
  if (value === undefined || value === null || typeof value !== 'string') {
    return undefined;
  }

  const trimmedValue = value.trim();
  if (!trimmedValue) {
    return undefined;
  }

  try {
    const url = new URL(trimmedValue);
    return ['http:', 'https:'].includes(url.protocol) ? trimmedValue : undefined;
  } catch {
    return undefined;
  }
};

export const validateSignup = [
  body('firstName')
    .trim()
    .notEmpty()
    .withMessage('First name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),

  body('lastName')
    .trim()
    .notEmpty()
    .withMessage('Last name is required')
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),

  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage(ERROR_MESSAGES.INVALID_EMAIL)
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .custom((value) => {
      if (!validatePasswordStrength(value)) {
        throw new Error(ERROR_MESSAGES.INVALID_PASSWORD_FORMAT);
      }
      return true;
    }),

  body('confirmPassword')
    .notEmpty()
    .withMessage('Confirm password is required')
    .custom((value, { req }) => {
      if (value !== req.body.password) {
        throw new Error('Passwords do not match');
      }
      return true;
    }),

  body('phone')
    .optional()
    .trim()
    .isMobilePhone()
    .withMessage(ERROR_MESSAGES.INVALID_PHONE),

  body('dateOfBirth')
    .optional()
    .isISO8601()
    .withMessage('Invalid date format'),

  body('gender')
    .optional()
    .isIn(['male', 'female', 'other', 'prefer_not_to_say'])
    .withMessage('Invalid gender'),
];

export const validateLogin = [
  body('email')
    .trim()
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage(ERROR_MESSAGES.INVALID_EMAIL)
    .normalizeEmail(),

  body('password')
    .notEmpty()
    .withMessage('Password is required'),
];

export const validateOnboarding = [
  body('dateOfBirth')
    .notEmpty()
    .withMessage('Date of birth is required')
    .isISO8601()
    .withMessage('Invalid date format'),

  body('gender')
    .notEmpty()
    .withMessage('Gender is required')
    .isIn(['male', 'female', 'other', 'prefer_not_to_say'])
    .withMessage('Invalid gender'),

  body('phone')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isMobilePhone()
    .withMessage(ERROR_MESSAGES.INVALID_PHONE),

  body('profilePicture')
    .customSanitizer(normalizeProfilePicture),
];

export const validateProfileUpdate = [
  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),

  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),

  body('phone')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .isMobilePhone()
    .withMessage(ERROR_MESSAGES.INVALID_PHONE),

  body('dateOfBirth')
    .optional({ nullable: true, checkFalsy: true })
    .isISO8601()
    .withMessage('Invalid date format'),

  body('gender')
    .optional({ nullable: true, checkFalsy: true })
    .isIn(['male', 'female', 'other', 'prefer_not_to_say'])
    .withMessage('Invalid gender'),

  body('profilePicture')
    .customSanitizer(normalizeProfilePicture),
];

export const validateChangePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),

  body('newPassword')
    .notEmpty()
    .withMessage('New password is required')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters')
    .custom((value) => {
      if (!validatePasswordStrength(value)) {
        throw new Error(ERROR_MESSAGES.INVALID_PASSWORD_FORMAT);
      }
      return true;
    }),
];

export const validateDeleteAccount = [
  body('password')
    .notEmpty()
    .withMessage('Password is required'),
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
