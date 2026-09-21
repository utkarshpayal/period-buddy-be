import jwt from 'jsonwebtoken';
import logger from './logger.js';

// A short/missing/default JWT_SECRET makes every issued token trivially
// forgeable. Validated once at module load (this file is imported very
// early, via authMiddleware.js) so a weak secret fails the deploy at boot
// instead of silently shipping a forgeable auth system — .env.example ships
// an obviously-placeholder value precisely so a real deploy that forgot to
// override it gets caught here, not in production traffic. Only *refused*
// (thrown) in production — a local/dev secret that predates this check
// still just gets a loud warning, so this doesn't retroactively break an
// existing dev environment's .env.
const MIN_JWT_SECRET_LENGTH = 32;
const jwtSecretProblem = !process.env.JWT_SECRET
  ? 'missing'
  : process.env.JWT_SECRET.length < MIN_JWT_SECRET_LENGTH
    ? 'too_short'
    : null;

if (jwtSecretProblem) {
  logger.error('jwt_secret_invalid', {
    action: 'jwt_secret_invalid',
    reason: jwtSecretProblem,
    minLength: MIN_JWT_SECRET_LENGTH,
  });
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      `JWT_SECRET must be set and at least ${MIN_JWT_SECRET_LENGTH} characters long. Refusing to start.`,
    );
  }
}

// `options` lets callers override the default session expiry — e.g. the
// short-lived (~30 min) token minted for a Samvaad outbound check-in call
// (see samvaadClient.js), which must not live as long as a normal login
// session.
export const generateToken = (payload, options = {}) => {
  try {
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '7d',
      ...options,
    });
    return token;
  } catch (error) {
    throw new Error('Error generating token', { cause: error });
  }
};

export const verifyToken = (token) => {
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    return decoded;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new Error('Token expired', { cause: error });
    }
    throw new Error(`Invalid token: ${error.message}`, { cause: error });
  }
};

export const decodeToken = (token) => {
  try {
    return jwt.decode(token);
  } catch (error) {
    throw new Error('Error decoding token', { cause: error });
  }
};
