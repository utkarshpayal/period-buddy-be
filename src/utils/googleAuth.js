import { OAuth2Client } from 'google-auth-library';
import logger from './logger.js';

// Any of these client IDs (web/iOS/Android/Expo-proxy) are accepted as valid
// audiences — a mobile app signing in with its native client ID produces an
// ID token whose `aud` won't match the web client ID, so all of them must be
// registered here for verifyIdToken to accept the token.
const ALLOWED_AUDIENCES = [
  process.env.GOOGLE_WEB_CLIENT_ID,
  process.env.GOOGLE_IOS_CLIENT_ID,
  process.env.GOOGLE_ANDROID_CLIENT_ID,
  process.env.GOOGLE_EXPO_CLIENT_ID,
].filter(Boolean);

let client = null;

export const isGoogleAuthConfigured = () => ALLOWED_AUDIENCES.length > 0;

const getClient = () => {
  if (!client) client = new OAuth2Client();
  return client;
};

/**
 * Verifies a Google-issued ID token and returns the decoded payload
 * (sub, email, given_name, family_name, picture, email_verified, ...).
 * Throws if the token is invalid, expired, or its audience isn't one of
 * this app's registered Google OAuth client IDs.
 */
export const verifyGoogleIdToken = async (idToken) => {
  if (!isGoogleAuthConfigured()) {
    throw new Error('Google sign-in is not configured on the server.');
  }
  if (!idToken || typeof idToken !== 'string') {
    throw new Error('Missing Google ID token.');
  }

  try {
    const ticket = await getClient().verifyIdToken({
      idToken,
      audience: ALLOWED_AUDIENCES,
    });
    return ticket.getPayload();
  } catch (error) {
    logger.error('google_id_token_verify_failed', {
      action: 'google_id_token_verify_failed',
      error: error.message,
    });
    throw new Error('Invalid or expired Google sign-in token.');
  }
};
