import BuddyMatch from '../models/BuddyMatch.js';
import Consultation from '../models/Consultation.js';
import Doctor from '../models/Doctor.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { notifyUserLive } from '../utils/consultationLifecycle.js';
import { isUserInRoom } from '../config/websocket.js';
import {
  evaluateJoinAccess,
  getVideoConfig,
  newRoomName,
  pseudonymousId,
  signJitsiToken,
} from '../utils/videoCall.js';

/**
 * Every video call runs on the self-hosted Jitsi server (see utils/videoCall.js).
 *
 *   POST /api/consultation/:id/video/join              (the booked patient)
 *   POST /api/doctor/consultations/:id/video/join      (the assigned doctor)
 *   POST /api/consultation/:id/video/attendance        { event: 'joined' | 'left' }
 *   POST /api/doctor/consultations/:id/video/attendance
 *   POST /api/buddies/video/join                       (either member of an active Period Buddy pairing)
 *
 * Consultation join checks, server-side and on every call: the caller is this
 * booking's patient or its doctor's login, the booking is paid/active with a
 * confirmed payment, and now is inside the join window. Buddy join checks the
 * caller is in an active pairing and the other member's account is live. Only
 * then is a short-lived token for this one room and this one person signed.
 * Tokens are never logged.
 */

const VIDEO_UNAVAILABLE = 'Video calls are not available right now.';

const ATTENDANCE_EVENTS = ['joined', 'left'];

// Last "the other side is waiting" ring per consultation + direction, so a
// reconnect (which fetches a fresh token) doesn't ring or push again.
const lastRingAt = new Map();
const RING_GAP_MS = 2 * 60 * 1000;
const BUDDY_RING_GAP_MS = 15 * 1000;

const sendJoinRefusal = (res, access) =>
  res.status(access.status).json({
    success: false,
    statusCode: access.status,
    message: access.message,
    code: access.code,
    ...(access.opensAt ? { opensAt: access.opensAt.toISOString() } : {}),
    ...(access.closesAt ? { closesAt: access.closesAt.toISOString() } : {}),
  });

/** A consultation's or pairing's room, created on first use. Atomic: two first joins agree. */
const ensureRoom = async (Model, id) => {
  const current = await Model.findById(id).select('+videoRoom').lean();
  if (current?.videoRoom) return current.videoRoom;
  await Model.updateOne(
    { _id: id, $or: [{ videoRoom: { $exists: false } }, { videoRoom: null }] },
    { $set: { videoRoom: newRoomName() } },
  );
  const saved = await Model.findById(id).select('+videoRoom').lean();
  return saved?.videoRoom || null;
};

const displayName = (user, fallback = 'Patient') =>
  [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || fallback;

/** At most one ring per `key` every `gapMs` (a reconnect fetches a fresh token). */
const claimRing = (key, gapMs = RING_GAP_MS) => {
  const last = lastRingAt.get(key) || 0;
  if (Date.now() - last < gapMs) return false;
  if (lastRingAt.size > 5000) lastRingAt.clear();
  lastRingAt.set(key, Date.now());
  return true;
};

/** Tell the other side someone is in the room (socket, and a push for the patient). */
/**
 * Whether one side of a consultation is in its call right now, from the call
 * screens' joined/left reports (client-reported: used only to decide whether
 * to ring, never for the session itself).
 */
export const isSideInCall = (attendance, side) => {
  const joined = attendance?.[`${side}JoinedAt`];
  if (!joined) return false;
  const left = attendance?.[`${side}LeftAt`];
  return !left || new Date(joined).getTime() > new Date(left).getTime();
};

const ringOtherSide = async ({
  consultationId,
  role,
  calleeUserId,
  calleeInCall,
  callerName,
  callerAvatarUrl,
}) => {
  // Already in the call (e.g. the doctor rejoined after a drop): no ring, no push.
  if (!calleeUserId || calleeInCall) return;
  if (!claimRing(`consultation:${consultationId}:${role}`)) return;

  notifyUserLive(calleeUserId, {
    event: 'incoming_call',
    kind: 'consultation',
    consultationId,
    callerName,
    callerAvatarUrl: callerAvatarUrl || null,
    callerRole: role === 'moderator' ? 'doctor' : 'patient',
  });
  if (role !== 'moderator') return;
  try {
    await Notification.create({
      userId: calleeUserId,
      type: 'consultation_update',
      title: `${callerName} is in your video consultation`,
      body: 'Tap to join the call.',
      data: { consultationId, kind: 'incoming_call' },
      sentAt: new Date(),
    });
  } catch (error) {
    logger.error('video_ring_push_failed', {
      action: 'video_ring_push_failed',
      consultationId,
      error: error.message,
    });
  }
};

/**
 * The shared join flow once the caller's side is known. `role` is
 * 'moderator' (doctor) or 'participant' (patient).
 */
const issueJoin = async (res, { consultation, role, me, peer }) => {
  const config = getVideoConfig();
  if (!config.configured) {
    return sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, VIDEO_UNAVAILABLE);
  }

  const access = evaluateJoinAccess(consultation, config);
  if (!access.ok) return sendJoinRefusal(res, access);

  const roomName = await ensureRoom(Consultation, consultation._id);
  if (!roomName) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');

  const { token, expiresAt } = signJitsiToken(
    { roomName, role, user: me, closesAt: access.closesAt },
    config,
  );

  const side = role === 'moderator' ? 'doctor' : 'patient';
  // First join moves a paid session to active, as starting a call always has.
  // Never to completed: only the doctor or the overdue job completes a session.
  await Consultation.updateOne(
    { _id: consultation._id, status: { $in: ['paid', 'active'] } },
    { $set: { status: 'active', [`videoAttendance.${side}TokenAt`]: new Date() } },
  );

  logger.info('consultation_video_token_issued', {
    action: 'consultation_video_token_issued',
    consultationId: String(consultation._id),
    role,
    expiresAt,
  });

  await ringOtherSide({
    consultationId: String(consultation._id),
    role,
    calleeUserId: peer.userId,
    calleeInCall: isSideInCall(
      consultation.videoAttendance,
      side === 'doctor' ? 'patient' : 'doctor',
    ),
    callerName: me.name,
    callerAvatarUrl: role === 'moderator' ? me.avatar : null,
  });

  return sendResponse(res, HTTP_STATUS.OK, 'Video room ready', {
    domain: config.domain,
    roomName,
    meetingUrl: `https://${config.domain}/${roomName}`,
    token,
    role,
    expiresAt: expiresAt.toISOString(),
    joinWindow: {
      opensAt: access.opensAt ? access.opensAt.toISOString() : null,
      closesAt: access.closesAt ? access.closesAt.toISOString() : null,
    },
    displayName: me.name,
    peerName: peer.name,
  });
};

/** POST /api/consultation/:id/video/join — the booked patient. */
export const joinAsPatient = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }
    const consultation = await Consultation.findOne({ _id: req.params.id, userId: req.userId });
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');
    const doctor = await Doctor.findById(consultation.doctorId).select('name userId').lean();
    return issueJoin(res, {
      consultation,
      role: 'participant',
      me: { id: req.userId, name: displayName(req.user) },
      peer: {
        userId: doctor?.userId ? String(doctor.userId) : null,
        name: doctor?.name || 'Your doctor',
      },
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/consultations/:id/video/join — the assigned doctor. */
export const joinAsDoctor = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }
    const doctor = await Doctor.findOne({ userId: req.userId }).select('name avatarUrl').lean();
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    const consultation = await Consultation.findOne({ _id: req.params.id, doctorId: doctor._id });
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');
    const patient = await User.findById(consultation.userId).select('firstName lastName').lean();
    return issueJoin(res, {
      consultation,
      role: 'moderator',
      me: { id: req.userId, name: doctor.name || 'Doctor', avatar: doctor.avatarUrl || null },
      peer: { userId: String(consultation.userId), name: displayName(patient) },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Client-reported attendance. Untrusted: recorded for support/analytics
 * (last join, last leave per side) and to decide whether to ring; it never
 * changes status, payment or earnings. Closing the call screen does not complete a session.
 */
const recordAttendance = async (req, res, filter, side, otherUserId) => {
  const event = req.body?.event;
  if (!ATTENDANCE_EVENTS.includes(event)) {
    return sendError(res, HTTP_STATUS.BAD_REQUEST, "event must be 'joined' or 'left'");
  }
  const now = new Date();
  // Last join and last leave per side (so "in the call" = joined after last left).
  const field = event === 'joined' ? `${side}JoinedAt` : `${side}LeftAt`;
  const updated = await Consultation.findOneAndUpdate(
    { ...filter, status: { $in: ['paid', 'active', 'completed'] } },
    { $max: { [`videoAttendance.${field}`]: now } },
    { new: true },
  )
    .select('_id userId doctorId videoAttendance')
    .lean();
  if (!updated) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');

  // Left before the other side came in: stop their ring ("is waiting" would be
  // stale), and let a later rejoin ring again straight away.
  if (event === 'left') {
    const otherSide = side === 'doctor' ? 'patient' : 'doctor';
    const consultationId = String(updated._id);
    lastRingAt.delete(
      `consultation:${consultationId}:${side === 'doctor' ? 'moderator' : 'participant'}`,
    );
    if (!isSideInCall(updated.videoAttendance, otherSide)) {
      const target = await otherUserId(updated);
      if (target) notifyUserLive(target, { event: 'call_cancelled', consultationId });
    }
  }
  return sendResponse(res, HTTP_STATUS.OK, 'Noted', { recorded: true });
};

/** POST /api/consultation/:id/video/attendance */
export const reportPatientAttendance = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }
    return await recordAttendance(
      req,
      res,
      { _id: req.params.id, userId: req.userId },
      'patient',
      async (c) => (await Doctor.findById(c.doctorId).select('userId').lean())?.userId,
    );
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/consultations/:id/video/attendance */
export const reportDoctorAttendance = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }
    const doctor = await Doctor.findOne({ userId: req.userId }).select('_id').lean();
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    return await recordAttendance(
      req,
      res,
      { _id: req.params.id, doctorId: doctor._id },
      'doctor',
      async (c) => c.userId,
    );
  } catch (error) {
    next(error);
  }
};

/**
 * Who is in a buddy pairing's chat right now (`buddy_<roomKey>` socket room).
 * An object so tests can swap the check.
 */
export const buddyPresence = {
  inChat: (roomKey, userId) => isUserInRoom(`buddy_${roomKey}`, userId),
};

/**
 * POST /api/buddies/video/join — a call with the caller's active Period Buddy,
 * only while **both** of them have the pairing's chat open (same rule as the
 * app's video button, enforced here too). Both are plain participants (nobody
 * can mute or remove the other). The token carries a per-pairing pseudonymous
 * id, not the account id. No time window. Ending the pairing deletes the match
 * (and its room), so no new token can be issued for it.
 */
export const joinBuddyCall = async (req, res, next) => {
  try {
    const config = getVideoConfig();
    if (!config.configured) {
      return sendError(res, HTTP_STATUS.SERVICE_UNAVAILABLE, VIDEO_UNAVAILABLE);
    }
    const match = await BuddyMatch.findOne({ members: req.userId, status: 'active' })
      .sort({ createdAt: -1 })
      .select('members roomKey');
    if (!match) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No active Period Buddy');
    const otherId = match.members.find((m) => String(m) !== String(req.userId));
    const other = await User.findOne({ _id: otherId, isActive: true, deletedAt: null })
      .select('firstName lastName')
      .lean();
    if (!other) {
      return sendError(res, HTTP_STATUS.CONFLICT, "Your Period Buddy can't take calls right now.");
    }
    const otherName = displayName(other, 'Your Period Buddy');
    if (!buddyPresence.inChat(match.roomKey, req.userId)) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        statusCode: HTTP_STATUS.CONFLICT,
        code: 'BUDDY_CHAT_NOT_OPEN',
        message: 'Open your buddy chat to start a call.',
      });
    }
    if (!buddyPresence.inChat(match.roomKey, otherId)) {
      return res.status(HTTP_STATUS.CONFLICT).json({
        success: false,
        statusCode: HTTP_STATUS.CONFLICT,
        code: 'BUDDY_OFFLINE',
        message: `${otherName} is offline. Video calls need both of you online in the chat.`,
      });
    }

    const roomName = await ensureRoom(BuddyMatch, match._id);
    if (!roomName) return sendError(res, HTTP_STATUS.NOT_FOUND, 'No active Period Buddy');

    const myName = displayName(req.user, 'Period Buddy');
    const { token, expiresAt } = signJitsiToken(
      {
        roomName,
        role: 'participant',
        user: { id: pseudonymousId(req.userId, match._id, config.appSecret), name: myName },
      },
      config,
    );

    logger.info('buddy_video_token_issued', {
      action: 'buddy_video_token_issued',
      matchId: String(match._id),
      expiresAt,
    });

    // They're in the chat (checked above): a live prompt there is enough, no push.
    // Short gap: a second "call" after the buddy tapped "Not now" must prompt again.
    if (claimRing(`buddy:${match._id}:${req.userId}`, BUDDY_RING_GAP_MS)) {
      notifyUserLive(otherId, { event: 'incoming_call', kind: 'buddy', callerName: myName });
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Video room ready', {
      domain: config.domain,
      roomName,
      meetingUrl: `https://${config.domain}/${roomName}`,
      token,
      role: 'participant',
      expiresAt: expiresAt.toISOString(),
      joinWindow: { opensAt: null, closesAt: null },
      displayName: myName,
      peerName: otherName,
    });
  } catch (error) {
    next(error);
  }
};
