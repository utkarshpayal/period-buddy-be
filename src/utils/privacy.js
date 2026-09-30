import { HTTP_STATUS } from '../constants/httpStatus.js';

/**
 * Consent for sending a person's content to our AI provider (Sarvam AI:
 * Nura AI chat, reading uploaded documents, report summaries, speech, the
 * voice companion and check-in calls).
 *
 * - `consents.aiProcessing.granted === false`: they said no. Every AI
 *   feature is off for them, always.
 * - `true`: allowed.
 * - Never asked (everyone before this existed, and app builds that can't ask
 *   yet): allowed until AI_CONSENT_ENFORCED=true. Turn that on once the app
 *   release that asks for consent is out, so nobody loses AI features
 *   without having been asked.
 *
 * Signed-out use (e.g. an anonymous question in Nura AI) carries no
 * personal data and isn't tied to anyone, so it isn't gated.
 */

/** Bump when what's shared or with whom changes; the app then asks again. */
export const AI_CONSENT_VERSION = '2026-10';
export const AI_PROVIDERS = ['Sarvam AI (India)'];

export const aiAllowed = (user) => {
  if (!user) return true;
  const granted = user.consents?.aiProcessing?.granted;
  if (granted === false) return false;
  if (granted === true) return true;
  return process.env.AI_CONSENT_ENFORCED !== 'true';
};

export const AI_CONSENT_REQUIRED = 'AI_CONSENT_REQUIRED';

/** Route guard for AI features: 403 with code AI_CONSENT_REQUIRED. */
export const requireAiConsent = (req, res, next) => {
  if (aiAllowed(req.user)) return next();
  return res.status(HTTP_STATUS.FORBIDDEN).json({
    success: false,
    statusCode: HTTP_STATUS.FORBIDDEN,
    code: AI_CONSENT_REQUIRED,
    message:
      'AI features are turned off for your account. You can turn them on in Profile → Data privacy & security.',
  });
};

/** What the app shows on its privacy screen. */
export const describeConsents = (user) => ({
  aiProcessing: {
    granted: user.consents?.aiProcessing?.granted ?? null,
    version: user.consents?.aiProcessing?.version ?? null,
    updatedAt: user.consents?.aiProcessing?.updatedAt ?? null,
    currentVersion: AI_CONSENT_VERSION,
    providers: AI_PROVIDERS,
    allowedNow: aiAllowed(user),
  },
});

/** What a push says when the person hides notification details. */
export const PRIVATE_PUSH = {
  title: 'The Nura',
  body: 'You have a new update. Open the app to see it.',
};

/** "Hide notification details" is on unless the person turned it off. */
export const hidesNotificationDetails = (user) =>
  user?.privacySettings?.hideNotificationDetails !== false;

/**
 * The push to actually send this person: the real one, or neutral text with
 * no banner image (which could show details too) when they hide details.
 * Every device push goes through this: automatic ones, admin test pushes and
 * broadcasts. Tapping still opens the right screen (data is kept).
 */
export const pushFor = (user, { title, body, data }) => {
  if (!hidesNotificationDetails(user)) return { title, body, data };
  const { image: _image, ...rest } = data || {};
  return { ...PRIVATE_PUSH, data: rest };
};

/** Choices for how long Nura AI chats are kept (0 = until deleted). */
export const AI_CHAT_RETENTION_OPTIONS = [0, 30, 90, 365];

/** Settings under the privacy screen (User.privacySettings), with defaults. */
export const describePrivacySettings = (user) => ({
  hideNotificationDetails: user?.privacySettings?.hideNotificationDetails !== false,
  aiChatRetentionDays: user?.privacySettings?.aiChatRetentionDays ?? 0,
  newSignInAlerts: user?.privacySettings?.newSignInAlerts !== false,
  aiChatRetentionOptions: AI_CHAT_RETENTION_OPTIONS,
});
