import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

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
    const message = {
      token,
      notification: {
        title,
        body,
      },
      // Custom sound bundled by the client (see expo-notifications plugin
      // config in app.json + the Android notification channel default in
      // lib/notifications.ts). Android references the raw resource name
      // without its extension; iOS/APNs needs the exact bundled filename.
      android: {
        notification: {
          sound: 'notification',
          channelId: 'default',
        },
      },
      apns: {
        payload: {
          aps: {
            sound: 'notification.wav',
          },
        },
      },
      data: data
        ? Object.entries(data).reduce((acc, [key, val]) => {
            acc[key] = String(val); // FCM data fields must be strings
            return acc;
          }, {})
        : {},
    };

    const response = await admin.messaging().send(message);
    logger.info('fcm_send_success', { messageId: response, token });
    return response;
  } catch (error) {
    logger.error('fcm_send_error | Failed to send push notification', {
      token,
      error: error.message,
    });
  }
};
