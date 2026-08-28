import logger from './logger.js';
import { generateToken } from './jwt.js';

// "Samvaad" (the informal name used for this feature elsewhere in this
// codebase) is Sarvam's OWN outbound-calling product — Instant Outbound,
// under apps.sarvam.ai — not a separate third-party vendor. It runs the
// "Buddy" cycle check-in voice agent over the phone. Distinct from
// sarvamClient.js, which talks to api.sarvam.ai (chat/TTS/STT/translate/doc
// extraction) with a different host and a different auth header entirely.
//
// Confirmed against https://docs.sarvam.ai/api-reference/instant-outbound/create.md
// and .../instant-outbound/webhook-payload.md — endpoint, auth header,
// request/response shape, and webhook payload shape all come from those
// pages, not guessed.
const SARVAM_ORG_ID = process.env.SARVAM_ORG_ID;
const SARVAM_WORKSPACE_ID = process.env.SARVAM_WORKSPACE_ID;
const SARVAM_APP_ID = process.env.SARVAM_APP_ID;
const SARVAM_APP_VERSION = process.env.SARVAM_APP_VERSION;
const SARVAM_CONNECTION_ID = process.env.SARVAM_CONNECTION_ID;
const SARVAM_AGENT_PHONE_NUMBER = process.env.SARVAM_AGENT_PHONE_NUMBER;
// Must be a publicly reachable HTTPS URL — Sarvam's servers POST the call
// outcome here, so this can't be localhost. Points at this same API
// (checkinCallWebhookRoutes.js), built from the base URL other outbound
// links already use (see newsletter unsubscribe links).
const API_BASE_URL = process.env.API_BASE_URL;

// How long the per-call auth token stays valid — comfortably longer than a
// typical check-in call, short enough that a leaked token is low-risk. Only
// used if the agent is configured with a tool that calls back into our API
// mid-call (see agent_variables.user_auth_token below) — the primary data
// path is the webhook + agent_variables extraction, not this token.
const CALL_TOKEN_TTL = process.env.SAMVAAD_CALL_TOKEN_TTL || '30m';

// Sarvam requires E.164 (a leading '+' + country code) for user_phone_number
// — confirmed by a live 422 "Invalid Parameter" against a stored phone like
// "8890866167" (no country code). Users commonly type just the bare 10-digit
// mobile number in the app (see period-buddy's checkin-call.tsx phone
// field), with nothing enforcing E.164 at save time (authSchema.js's
// isMobilePhone() check is locale-loose). Rather than force every stored
// `User.phone` in the DB to E.164 — a bigger, riskier change touching
// onboarding/profile elsewhere — normalize only at this boundary, since
// this app's user base is India-only.
const toE164 = (phone) => {
  const digits = String(phone || '').replace(/[^\d+]/g, '');
  if (digits.startsWith('+')) return digits;
  if (/^0\d{10}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^\d{10}$/.test(digits)) return `+91${digits}`;
  if (/^91\d{10}$/.test(digits)) return `+${digits}`;
  // Unrecognized shape — pass through as-is so Sarvam's own error (rather
  // than a silently wrong guess) is what the caller sees.
  return digits;
};

const outboundCallUrl = () =>
  `https://apps.sarvam.ai/api/outbounds/v1/orgs/${SARVAM_ORG_ID}/workspaces/${SARVAM_WORKSPACE_ID}/outbounds`;

export const isSamvaadConfigured = () =>
  Boolean(
    process.env.SARVAM_OUTBOUND_API_KEY &&
    SARVAM_ORG_ID &&
    SARVAM_WORKSPACE_ID &&
    SARVAM_APP_ID &&
    SARVAM_APP_VERSION &&
    SARVAM_CONNECTION_ID &&
    SARVAM_AGENT_PHONE_NUMBER &&
    API_BASE_URL,
  );

const authHeaders = () => {
  const apiKey = process.env.SARVAM_OUTBOUND_API_KEY;
  if (!isSamvaadConfigured()) {
    throw new Error(
      'Check-in calling is not configured on the server (missing one of SARVAM_OUTBOUND_API_KEY / SARVAM_ORG_ID / SARVAM_WORKSPACE_ID / SARVAM_APP_ID / SARVAM_APP_VERSION / SARVAM_CONNECTION_ID / SARVAM_AGENT_PHONE_NUMBER / API_BASE_URL)',
    );
  }
  // apps.sarvam.ai (this outbound-calling product) authenticates with
  // X-API-Key, unlike api.sarvam.ai's api-subscription-key header used in
  // sarvamClient.js — confirmed from Sarvam's own campaign-creation curl
  // example, not assumed.
  return { 'X-API-Key': apiKey };
};

async function readJsonOrThrow(response, action) {
  const raw = await response.text();
  let body = {};
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch {
    // Non-JSON body (e.g. an upstream gateway error page) — fall through to
    // the generic message below using the raw text instead.
  }
  if (!response.ok) {
    const message =
      body?.error?.message ||
      body?.message ||
      raw ||
      `Sarvam outbound request failed (${response.status})`;
    logger.error(action, { action, status: response.status, error: message });
    throw new Error(message);
  }
  return body;
}

/**
 * Mints the per-call bearer token an agent-side tool could use to call our
 * own /api/cycle/log on this user's behalf for the duration of the call.
 * Passed into agent_variables below so it's available if the agent is
 * configured with such a tool — the primary data path back to us is still
 * the webhook (see checkin-call/webhook route), which needs no token at all.
 */
export const issueCallToken = (userId) => generateToken({ userId }, { expiresIn: CALL_TOKEN_TTL });

/**
 * Triggers a single outbound cycle check-in call for one user via Sarvam's
 * Instant Outbound API.
 *
 * @param {object} user - plain object with the fields the call needs:
 *   { id, phone, name, gender, expectedPeriodDate, lastCycleSummary }
 * @returns {Promise<{ attempt_id: string }>}
 */
export const startCheckinCall = async (user) => {
  const userPhoneNumber = toE164(user.phone);
  const payload = {
    app_config: {
      app_id: SARVAM_APP_ID,
      app_version: Number(SARVAM_APP_VERSION),
      connection_config: {
        connection_id: SARVAM_CONNECTION_ID,
        agent_phone_number: SARVAM_AGENT_PHONE_NUMBER,
      },
      agent_variables: {
        user_name: user.name,
        expected_period_date: user.expectedPeriodDate,
        last_cycle_summary: user.lastCycleSummary || '',
        gender: user.gender || 'female',
        user_auth_token: issueCallToken(user.id),
      },
    },
    user_config: {
      user_phone_number: userPhoneNumber,
    },
    webhook_config: {
      url: `${API_BASE_URL}/api/voice-agent/checkin-call/webhook`,
      // Echoed back verbatim in the webhook payload — the only way to
      // correlate a call outcome back to this user (Sarvam's attempt_id
      // isn't ours to look up by).
      metadata: { userId: String(user.id) },
    },
  };

  const response = await fetch(outboundCallUrl(), {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    // Sarvam's error responses so far (e.g. 422 "Invalid Parameter") don't
    // name which field was wrong — log everything we sent except the auth
    // token, so the next failure is diagnosable from logs alone instead of
    // another round of guessing.
    logger.error('sarvam_outbound_request', {
      action: 'sarvam_outbound_request',
      appId: SARVAM_APP_ID,
      appVersion: SARVAM_APP_VERSION,
      connectionId: SARVAM_CONNECTION_ID,
      agentPhoneNumber: SARVAM_AGENT_PHONE_NUMBER,
      userPhoneNumber,
      webhookUrl: payload.webhook_config.url,
    });
  }

  const data = await readJsonOrThrow(response, 'sarvam_outbound_start_call_failed');

  logger.info('checkin_call_started', {
    action: 'checkin_call_started',
    userId: user.id,
    attemptId: data.attempt_id,
  });

  return data;
};
