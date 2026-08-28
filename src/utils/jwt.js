import jwt from 'jsonwebtoken';

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
