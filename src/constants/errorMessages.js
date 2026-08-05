export const ERROR_MESSAGES = {
  // Auth Errors
  USER_NOT_FOUND: 'User not found',
  INVALID_CREDENTIALS: 'Invalid email or password',
  EMAIL_ALREADY_EXISTS: 'Email already registered',
  WEAK_PASSWORD:
    'Password must be at least 8 characters with uppercase, lowercase, number and special character',
  INVALID_EMAIL: 'Please provide a valid email address',
  MISSING_FIELDS: 'Please provide all required fields',

  // Token Errors
  NO_TOKEN: 'No authentication token provided',
  INVALID_TOKEN: 'Invalid or expired token',
  TOKEN_EXPIRED: 'Authentication token has expired',

  // Server Errors
  INTERNAL_SERVER_ERROR: 'Internal server error',
  DATABASE_ERROR: 'Database connection error',

  // Validation Errors
  INVALID_PHONE: 'Please provide a valid phone number',
  INVALID_PASSWORD_FORMAT:
    'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',

  // OTP Errors
  OTP_NOT_FOUND: 'No pending signup found for this email. Please sign up again.',
  OTP_EXPIRED: 'This code has expired. Please request a new one.',
  OTP_INVALID: 'Invalid verification code',
  OTP_MAX_ATTEMPTS: 'Too many incorrect attempts. Please request a new code.',
  OTP_RESEND_TOO_SOON: 'Please wait a moment before requesting another code.',

  // Google Sign-In Errors
  GOOGLE_TOKEN_MISSING: 'Google ID token is required',
  GOOGLE_EMAIL_MISSING: 'Your Google account has no email address to sign in with',
  GOOGLE_ONLY_ACCOUNT:
    'This account was created with Google. Please use "Continue with Google" to sign in.',

  // Upload Errors
  NO_FILE_UPLOADED: 'No file was uploaded',
  UPLOAD_FAILED: 'Failed to upload file',

  // Self-service Account Deletion Errors (marketing site "delete my data" page)
  SELF_DELETE_NO_REQUEST:
    'No pending deletion request found for this email. Please request a code again.',
  SELF_DELETE_OTP_EXPIRED: 'This code has expired. Please request a new one.',
  SELF_DELETE_OTP_INVALID: 'Invalid confirmation code',
  SELF_DELETE_OTP_MAX_ATTEMPTS: 'Too many incorrect attempts. Please request a new code.',
  SELF_DELETE_RESEND_TOO_SOON: 'Please wait a moment before requesting another code.',
};

export const SUCCESS_MESSAGES = {
  SIGNUP_SUCCESS: 'User registered successfully',
  OTP_SENT: 'Verification code sent to your email',
  OTP_RESENT: 'A new verification code has been sent to your email',
  OTP_VERIFIED: 'Account verified successfully',
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logout successful',
  PROFILE_FETCHED: 'Profile fetched successfully',
  EMAIL_VERIFIED: 'Email verified successfully',
  ONBOARDING_COMPLETE: 'Onboarding completed successfully',
  FILE_UPLOADED: 'File uploaded successfully',
  SELF_DELETE_OTP_SENT: 'A confirmation code has been sent to that email address',
  SELF_DELETE_COMPLETE: 'Account and all associated data permanently deleted',
};
