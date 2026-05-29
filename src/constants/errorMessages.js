export const ERROR_MESSAGES = {
  // Auth Errors
  USER_NOT_FOUND: 'User not found',
  INVALID_CREDENTIALS: 'Invalid email or password',
  EMAIL_ALREADY_EXISTS: 'Email already registered',
  WEAK_PASSWORD: 'Password must be at least 8 characters with uppercase, lowercase, number and special character',
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
  INVALID_PASSWORD_FORMAT: 'Password must contain at least one uppercase letter, one lowercase letter, one number, and one special character',
};

export const SUCCESS_MESSAGES = {
  SIGNUP_SUCCESS: 'User registered successfully',
  LOGIN_SUCCESS: 'Login successful',
  LOGOUT_SUCCESS: 'Logout successful',
  PROFILE_FETCHED: 'Profile fetched successfully',
  EMAIL_VERIFIED: 'Email verified successfully',
  ONBOARDING_COMPLETE: 'Onboarding completed successfully',
};
