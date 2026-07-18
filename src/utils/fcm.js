import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import logger from './logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let isFcmInitialized = false;

try {
  // Check if firebase-service-account.json exists
  const serviceAccountPath = path.join(__dirname, 'firebase-service-account.json');
  
  if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });
    isFcmInitialized = true;
    logger.info('fcm_initialized | Firebase Admin SDK initialized successfully');
  } else {
    logger.warn('fcm_init_warning | Firebase Admin SDK not initialized: src/utils/firebase-service-account.json not found. Push notifications will be logged only.');
  }
} catch (error) {
  logger.error('fcm_init_error | Failed to initialize Firebase Admin SDK', { error: error.message });
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
      data: data ? Object.entries(data).reduce((acc, [key, val]) => {
        acc[key] = String(val); // FCM data fields must be strings
        return acc;
      }, {}) : {},
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
