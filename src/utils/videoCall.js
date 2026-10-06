import crypto from 'crypto';
import jwt from 'jsonwebtoken';

/**
 * Every video call in Nura (doctor consultations and Period Buddy calls) runs
 * on the self-hosted Jitsi server (meet.thenura.care). Pure helpers: config,
 * the consultation join window, room names and the per-participant JWT. The
 * HTTP side is in controllers/videoCallController.js; the Jitsi server is in
 * infra/jitsi/.
 *
 * Security model: the Jitsi server only admits a participant holding a token
 * signed with JITSI_APP_SECRET (JWT_ALLOW_EMPTY=0, no guest domain), the
 * token's `room` claim must equal the room joined (prosody token_verification),
 * and the moderator role comes only from `context.user.affiliation` via
 * prosody's token_affiliation module (jicofo auto-owner and jicofo auth are off,
 * see infra/jitsi/README.md). The secret never leaves this server.
 */

const toInt = (value, fallback, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) => {
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
};

/** Read on every call (not at import) so ops can change env and tests can set it. */
export const getVideoConfig = (env = process.env) => {
  const domain = String(env.JITSI_DOMAIN || '')
    .trim()
    .toLowerCase();
  const appId = String(env.JITSI_APP_ID || '').trim();
  const appSecret = String(env.JITSI_APP_SECRET || '');
  return {
    // Video calls are off (join answers 503) until all three are set.
    configured: Boolean(domain && appId && appSecret.length >= 32),
    domain,
    appId,
    appSecret,
    audience: String(env.JITSI_AUDIENCE || 'jitsi').trim(),
    tokenTtlSeconds: toInt(env.JITSI_TOKEN_TTL_SECONDS, 600, { min: 60, max: 3600 }),
    joinEarlyMinutes: toInt(env.CONSULTATION_JOIN_EARLY_MINUTES, 10, { max: 24 * 60 }),
    joinGraceMinutes: toInt(env.CONSULTATION_JOIN_GRACE_MINUTES, 30, { max: 24 * 60 }),
    // Slots saved without an end (older bookings): assume this long.
    defaultDurationMinutes: toInt(env.CONSULTATION_DEFAULT_DURATION_MINUTES, 60, {
      min: 5,
      max: 24 * 60,
    }),
  };
};

/** Statuses a call can happen in. */
export const JOINABLE_STATUSES = ['paid', 'active'];

/**
 * When `consultation` can be joined: `{ opensAt, closesAt }` (Dates), or
 * nulls for a booking from before slots existed (joinable while live).
 */
export const joinWindowFor = (consultation, config) => {
  if (!consultation?.scheduledFor) return { opensAt: null, closesAt: null };
  const start = new Date(consultation.scheduledFor).getTime();
  const end = consultation.slotEndsAt
    ? new Date(consultation.slotEndsAt).getTime()
    : start + config.defaultDurationMinutes * 60000;
  return {
    opensAt: new Date(start - config.joinEarlyMinutes * 60000),
    closesAt: new Date(end + config.joinGraceMinutes * 60000),
  };
};

/**
 * Whether a consultation can be joined right now. Pure: the caller has
 * already checked the user is its patient or its doctor.
 * Returns `{ ok: true, opensAt, closesAt }` or `{ ok: false, status, code, message, opensAt?, closesAt? }`.
 */
export const evaluateJoinAccess = (consultation, config, now = new Date()) => {
  if (!consultation) {
    return { ok: false, status: 404, code: 'NOT_FOUND', message: 'Consultation not found' };
  }
  if (!JOINABLE_STATUSES.includes(consultation.status)) {
    const message =
      consultation.status === 'pending'
        ? 'This booking has not been paid yet.'
        : consultation.status === 'completed'
          ? 'This consultation has already been completed.'
          : 'This consultation was cancelled.';
    return { ok: false, status: 409, code: 'CONSULTATION_NOT_LIVE', message };
  }
  if (consultation.paymentStatus !== 'paid' || consultation.refundStatus) {
    return {
      ok: false,
      status: 402,
      code: 'PAYMENT_REQUIRED',
      message: 'This consultation has no confirmed payment.',
    };
  }
  const { opensAt, closesAt } = joinWindowFor(consultation, config);
  if (opensAt && now.getTime() < opensAt.getTime()) {
    return {
      ok: false,
      status: 403,
      code: 'JOIN_WINDOW_NOT_OPEN',
      message: `The video room opens ${config.joinEarlyMinutes} minutes before your slot.`,
      opensAt,
      closesAt,
    };
  }
  if (closesAt && now.getTime() > closesAt.getTime()) {
    return {
      ok: false,
      status: 403,
      code: 'JOIN_WINDOW_CLOSED',
      message: 'The time for this video consultation is over.',
      opensAt,
      closesAt,
    };
  }
  return { ok: true, opensAt, closesAt };
};

/**
 * A fresh, unguessable room name (128 random bits). Lowercase on purpose:
 * Jitsi lowercases room names and compares them to the token's `room` claim.
 * Never derived from the consultation id, which is visible to clients.
 */
export const newRoomName = () => `nura-${crypto.randomBytes(16).toString('hex')}`;

export const ROOM_NAME_PATTERN = /^nura-[0-9a-f]{32}$/;

/**
 * A stable stand-in for a user id inside one room: Jitsi can show a token's
 * `context.user.id` to the other participant, and a Period Buddy has no need
 * to learn the other person's account id.
 */
export const pseudonymousId = (userId, scope, secret) =>
  crypto.createHmac('sha256', secret).update(`${scope}:${userId}`).digest('hex').slice(0, 24);

/** Features Jitsi checks in the token; everything beyond the call itself is off. */
const DISABLED_FEATURES = {
  recording: false,
  livestreaming: false,
  transcription: false,
  'outbound-call': false,
  'sip-outbound-call': false,
  'file-upload': false,
  'list-visitors': false,
};

/**
 * Sign a Jitsi token for one participant of one room. `role` is 'moderator'
 * (the assigned doctor) or 'participant' (the patient). `expiresAt` is
 * capped at the join window's close. Returns `{ token, expiresAt }`.
 */
export const signJitsiToken = (
  { roomName, role, user, closesAt = null },
  config,
  now = new Date(),
) => {
  if (!ROOM_NAME_PATTERN.test(roomName)) throw new Error('Invalid room name');
  if (role !== 'moderator' && role !== 'participant') throw new Error('Invalid role');
  const nowSec = Math.floor(now.getTime() / 1000);
  let exp = nowSec + config.tokenTtlSeconds;
  if (closesAt) exp = Math.min(exp, Math.floor(new Date(closesAt).getTime() / 1000));
  const moderator = role === 'moderator';
  const payload = {
    aud: config.audience,
    iss: config.appId,
    // The Jitsi host's name (no port): JWT `sub`.
    sub: config.domain.split(':')[0],
    room: roomName,
    // A little slack for clock skew between this server and the Jitsi host.
    nbf: nowSec - 30,
    iat: nowSec,
    exp,
    context: {
      user: {
        id: String(user.id),
        name: String(user.name || '').slice(0, 80) || (moderator ? 'Doctor' : 'Patient'),
        ...(user.avatar ? { avatar: String(user.avatar) } : {}),
        // Read by prosody's token_affiliation module: owner => moderator.
        affiliation: moderator ? 'owner' : 'member',
        moderator,
      },
      features: DISABLED_FEATURES,
    },
  };
  const token = jwt.sign(payload, config.appSecret, {
    algorithm: 'HS256',
    jwtid: crypto.randomUUID(),
  });
  return { token, expiresAt: new Date(exp * 1000) };
};

/**
 * The `videoCall` summary attached to consultations sent to clients, so the
 * app and portal show "Join" from the server's rules, not their own.
 * `null` for sessions that can't have a call any more.
 */
export const describeVideoCall = (consultation, config = getVideoConfig(), now = new Date()) => {
  if (!consultation || !JOINABLE_STATUSES.includes(consultation.status)) return null;
  const { opensAt, closesAt } = joinWindowFor(consultation, config);
  const access = evaluateJoinAccess(consultation, config, now);
  return {
    // false while the Jitsi server isn't configured: clients say video is unavailable.
    available: config.configured,
    joinOpensAt: opensAt ? opensAt.toISOString() : null,
    joinClosesAt: closesAt ? closesAt.toISOString() : null,
    canJoinNow: access.ok && config.configured,
  };
};
