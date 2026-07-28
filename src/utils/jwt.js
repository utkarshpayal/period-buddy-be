import jwt from 'jsonwebtoken';

export const generateToken = (payload) => {
  try {
    const token = jwt.sign(payload, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRE || '7d',
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
