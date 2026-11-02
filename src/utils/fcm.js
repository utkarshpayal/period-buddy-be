import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';
import { pruneDeadTokens } from './pushTokens.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isFcmInitialized = false;

// The service account can come from either:
//   1. FIREBASE_SERVICE_ACCOUNT_JSON — the key file's JSON contents, raw or
//      base64-encoded (easiest on hosts where secrets are env vars), or
//   2. src/utils/firebase-service-account.json (gitignored) on disk.
// The env var wins when both are present.
const loadServiceAccount = () => {
  const fromEnv = process.env.FIREBASE_SERVICE_ACCOUNT_JSON?.trim();
  if (fromEnv) {
    const raw = fromEnv.startsWith('{') ? fromEnv : Buffer.from(fromEnv, 'base64').toString('utf8');
    const parsed = JSON.parse(raw);
    // Env-var UIs often store the key's newlines as literal "\n".
    if (typeof parsed.private_key === 'string') {
      parsed.private_key = parsed.private_key.replace(/\\n/g, '\n');
    }
    return { serviceAccount: parsed, source: 'FIREBASE_SERVICE_ACCOUNT_JSON' };
  }

  const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
  if (fs.existsSync(serviceAccountPath)) {
    return {
      serviceAccount: JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8')),
      source: 'src/utils/firebase-service-account.json',
    };
  }

  return null;
};

try {
  const loaded = loadServiceAccount();

  if (!loaded) {
    logger.warn(
      'fcm_init_warning | Firebase Admin SDK not initialized: neither FIREBASE_SERVICE_ACCOUNT_JSON nor src/utils/firebase-service-account.json is set. Push notifications will be logged only.',
    );
  } else {
    const { serviceAccount, source } = loaded;
    const requiredFields = ['project_id', 'client_email', 'private_key'];
    const missingFields = requiredFields.filter((field) => !serviceAccount[field]);

    if (missingFields.length > 0) {
      logger.warn(
        `fcm_init_warning | Firebase service account (${source}) is missing required field(s): ` +
          `${missingFields.join(', ')}. Push notifications will be logged only.`,
      );
    } else {
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
      });
      isFcmInitialized = true;
      logger.info(
        `fcm_initialized | Firebase Admin SDK initialized successfully (project ${serviceAccount.project_id}, from ${source})`,
      );
    }
  }
} catch (error) {
  logger.error('fcm_init_error | Failed to initialize Firebase Admin SDK', {
    error: error.message,
  });
}

// FCM error codes meaning the token will never work again (app uninstalled,
// token rotated, or malformed) — callers should clear it from the user.
const DEAD_TOKEN_CODES = new Set([
  'messaging/registration-token-not-registered',
  'messaging/invalid-registration-token',
]);

// 'messaging/invalid-argument' is ambiguous: FCM's HTTP v1 API returns it both
// for a malformed token *and* for a malformed message. Only treat it as a dead
// token when the error actually blames the token — otherwise one bad payload
// would wipe the token of every recipient it was sent to.
const isDeadTokenError = (error) =>
  Boolean(error) &&
  (DEAD_TOKEN_CODES.has(error.code) ||
    (error.code === 'messaging/invalid-argument' &&
      /registration token/i.test(error.message || '')));

// Must match the Android notification channel the app creates
// (The-Nura-App/lib/notifications.ts → ANDROID_CHANNEL_ID). A notification
// shown by the system while the app is killed/backgrounded uses this id; if
// it doesn't exist on the device, Android drops to a low-importance fallback
// channel (no heads-up banner).
export const ANDROID_CHANNEL_ID = 'default';

// Max messages per sendEach() call, enforced by FCM.
export const FCM_MAX_BATCH_SIZE = 500;

export const isFcmReady = () => isFcmInitialized;

const buildMessage = (token, { title, body, data }) => {
  // Admin pushes can carry a big picture (data.image, an https URL). Android
  // renders it natively; iOS needs mutable-content so a notification service
  // extension may attach it (without one, iOS just shows the text).
  const image = typeof data?.image === 'string' && data.image ? data.image : null;
  return {
    token,
    notification: {
      title,
      body,
      ...(image && { imageUrl: image }),
    },
    // Custom sound bundled by the client (see expo-notifications plugin
    // config in app.json + the Android notification channel default in
    // lib/notifications.ts). Android references the raw resource name
    // without its extension; iOS/APNs needs the exact bundled filename.
    android: {
      // High priority so Doze/app-standby don't defer delivery and the banner
      // shows as heads-up.
      priority: 'high',
      notification: {
        sound: 'notification',
        channelId: ANDROID_CHANNEL_ID,
      },
    },
    // Browsers (web app / PWA): the app's service worker (public/sw.js)
    // shows the notification and routes its tap from `data`.
    webpush: {
      headers: { Urgency: 'high' },
    },
    apns: {
      payload: {
        aps: {
          sound: 'notification.wav',
          ...(image && { 'mutable-content': 1 }),
        },
      },
      ...(image && { fcmOptions: { imageUrl: image } }),
    },
    data: data
      ? Object.entries(data).reduce((acc, [key, val]) => {
          if (val === undefined || val === null) return acc;
          // FCM data fields must be strings; objects would otherwise arrive as
          // "[object Object]".
          acc[key] = typeof val === 'object' ? JSON.stringify(val) : String(val);
          return acc;
        }, {})
      : {},
  };
};

/**
 * Sends a push notification to a specific FCM token
 * @param {string} token - The FCM registration token of the device
 * @param {object} payload - Notification payload { title, body, data }
 */
export const sendPushNotification = async (token, { title, body, data }) => {
  if (!token) return;

  if (!isFcmInitialized) {
    logger.info('fcm_send_mock | FCM not configured. Notification message:', {
      token,
      title,
      body,
      data,
    });
    return;
  }

  try {
    const response = await admin.messaging().send(buildMessage(token, { title, body, data }));
    logger.info('fcm_send_success', { messageId: response, token });
    return response;
  } catch (error) {
    logger.error('fcm_send_error | Failed to send push notification', {
      token,
      code: error.code,
      error: error.message,
    });
    // Uninstalled app / rotated token: drop it so we stop sending to it and
    // the admin "has device" counts stay honest.
    if (isDeadTokenError(error)) {
      await pruneDeadTokens([token]).catch(() => {});
    }
  }
};

/**
 * Sends the same notification to up to FCM_MAX_BATCH_SIZE tokens in a single
 * FCM round trip (sendEach). Never throws for per-token failures — those are
 * reported back so the caller can count them and prune dead tokens. Throws
 * only if FCM isn't configured or the whole request fails (network/auth), so
 * the caller can retry the batch.
 *
 * @param {string[]} tokens
 * @param {object} payload - { title, body, data }
 * @returns {Promise<{ successCount: number, failureCount: number, deadTokens: string[] }>}
 */
export const sendPushBatch = async (tokens, payload) => {
  if (!isFcmInitialized) throw new Error('FCM is not configured');
  if (tokens.length === 0) return { successCount: 0, failureCount: 0, deadTokens: [] };
  if (tokens.length > FCM_MAX_BATCH_SIZE) {
    throw new Error(`sendPushBatch accepts at most ${FCM_MAX_BATCH_SIZE} tokens`);
  }

  const response = await admin.messaging().sendEach(tokens.map((t) => buildMessage(t, payload)));

  const deadTokens = [];
  response.responses.forEach((r, i) => {
    if (!r.success && isDeadTokenError(r.error)) deadTokens.push(tokens[i]);
  });

  return {
    successCount: response.successCount,
    failureCount: response.failureCount,
    deadTokens,
  };
};
