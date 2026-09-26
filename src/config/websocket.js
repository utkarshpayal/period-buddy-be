import { WebSocketServer } from 'ws';
import url from 'url';
import { verifyToken } from '../utils/jwt.js';
import logger from '../utils/logger.js';
import Consultation from '../models/Consultation.js';
import Doctor from '../models/Doctor.js';
import BuddyMatch from '../models/BuddyMatch.js';
import Partner from '../models/Partner.js';
import User from '../models/User.js';

// Global map to track active rooms and client connections
// Room Name -> Set of WebSocket clients
const rooms = new Map();

// Map of WebSocket client to metadata (e.g. userId, rooms joined)
const clientMetadata = new Map();

/**
 * Whether `userId` is actually allowed into `room`. Room names are visible
 * client-side (`consultation_<id>`, `buddy_<roomKey>`, `partner_<id>`), and
 * Mongo ObjectIds are guessable within a time window, so without this check
 * any authenticated client could join any room by name and read/inject into
 * a chat, WebRTC signaling session, or partner-sync feed that isn't theirs.
 * Any room name that doesn't match a known, ownership-checked shape is
 * denied by default.
 */
const isLiveAccount = async (userId) =>
  Boolean(await User.exists({ _id: userId, isActive: true, deletedAt: null }));

const isAuthorizedForRoom = async (userId, room) => {
  if (!userId) return false;
  // A suspended/deleted account keeps a signature-valid JWT until it expires,
  // so re-check the account itself on every join, not just at connect time.
  if (!(await isLiveAccount(userId))) return false;

  // `user_<id>` personal rooms are auto-joined server-side on connect (see
  // wss.on('connection') below); the client also explicitly (re-)joins its
  // own on some screens, which is harmless as long as it's always the
  // caller's own id.
  if (room.startsWith('user_')) {
    return room === `user_${userId}`;
  }

  // Global public room every authenticated user may join, for live
  // community-feed updates (new posts/comments) — not scoped to a
  // particular resource, so there's no ownership to check beyond auth.
  if (room === 'community') return true;

  if (room.startsWith('consultation_')) {
    const consultationId = room.slice('consultation_'.length);
    const consultation = await Consultation.findById(consultationId);
    if (!consultation) return false;
    if (String(consultation.userId) === String(userId)) return true;
    const doctor = await Doctor.findById(consultation.doctorId);
    return Boolean(doctor && String(doctor.userId) === String(userId));
  }

  if (room.startsWith('buddy_')) {
    const roomKey = room.slice('buddy_'.length);
    const match = await BuddyMatch.findOne({ roomKey, status: 'active' });
    return Boolean(match && match.members.some((memberId) => String(memberId) === String(userId)));
  }

  if (room.startsWith('partner_')) {
    // Unlike consultation_/buddy_, this is NOT a shared room both sides
    // join — each side of a pairing has its own Partner document and its
    // own `partner_<that document's _id>` room; partnerController fans a
    // given event out to both sides' rooms separately (see
    // `broadcastToRoom(\`partner_${myProfile._id}\`, ...)` alongside
    // `broadcastToRoom(\`partner_${partnerProfile._id}\`, ...)`). So this
    // room is only ever joinable by the one user whose own Partner doc it is.
    const partnerDocId = room.slice('partner_'.length);
    const partner = await Partner.findById(partnerDocId);
    return Boolean(partner && String(partner.userId) === String(userId));
  }

  return false;
};

/**
 * Initializes the WebSocket Server
 * @param {object} server - HTTP Server instance
 */
export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', async (request, socket, head) => {
    const parsedUrl = url.parse(request.url, true);
    const token = parsedUrl.query.token;

    let userId = null;
    const hasToken = token && token !== 'null' && token !== 'undefined' && token.trim() !== '';
    if (hasToken) {
      try {
        const decoded = verifyToken(token);
        userId = decoded.userId;
      } catch (err) {
        logger.warn('ws_auth_failed', {
          message: 'Failed to verify token on upgrade',
          error: err.message,
        });
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }

      // Same rule as the REST `authenticate` middleware: a valid signature
      // isn't enough once the account has been suspended or deleted.
      let live = false;
      try {
        live = await isLiveAccount(userId);
      } catch (err) {
        logger.error('ws_account_check_failed', { userId, error: err.message });
      }
      if (!live) {
        logger.warn('ws_auth_inactive_account', { userId });
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request, userId);
    });
  });

  wss.on('connection', (ws, request, userId) => {
    logger.info('ws_connected', { userId });

    // Store metadata
    clientMetadata.set(ws, { userId, rooms: new Set() });

    if (userId) {
      const personalRoom = `user_${userId}`;
      if (!rooms.has(personalRoom)) {
        rooms.set(personalRoom, new Set());
      }
      rooms.get(personalRoom).add(ws);
      clientMetadata.get(ws).rooms.add(personalRoom);
      logger.info('ws_auto_joined_personal', { userId, room: personalRoom });
    }

    ws.on('message', async (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        const { type, room, text } = parsedMessage;

        if (type === 'join') {
          if (!room) return;

          const authorized = await isAuthorizedForRoom(userId, room);
          if (!authorized) {
            logger.warn('ws_room_join_denied', { userId, room });
            ws.send(
              JSON.stringify({ type: 'error', room, message: 'Not authorized to join this room' }),
            );
            return;
          }

          // A socket can close (and its metadata get torn down by the
          // 'close' handler below) while the authorization check above was
          // still pending — don't resurrect a dead client's entry.
          if (!clientMetadata.has(ws)) return;

          // Join room
          if (!rooms.has(room)) {
            rooms.set(room, new Set());
          }
          rooms.get(room).add(ws);
          clientMetadata.get(ws).rooms.add(room);

          logger.info('ws_room_joined', { userId, room });

          ws.send(
            JSON.stringify({
              type: 'joined',
              room,
              message: `Successfully joined room: ${room}`,
            }),
          );
        } else if (type === 'leave') {
          if (!room) return;

          if (rooms.has(room)) {
            rooms.get(room).delete(ws);
            if (rooms.get(room).size === 0) {
              rooms.delete(room);
            }
          }
          clientMetadata.get(ws).rooms.delete(room);

          logger.info('ws_room_left', { userId, room });

          ws.send(
            JSON.stringify({
              type: 'left',
              room,
              message: `Successfully left room: ${room}`,
            }),
          );
        } else if (type === 'message') {
          if (!room || !text?.trim()) return;
          // Only broadcast into a room this socket actually joined (and was
          // authorized for, at join time) — otherwise a client could skip
          // 'join' entirely and inject messages into any room by name.
          if (!clientMetadata.get(ws)?.rooms.has(room)) return;

          logger.info('ws_message_received', { userId, room, text: text.substring(0, 50) });

          // Broadcast to the room
          broadcastToRoom(room, {
            sender: 'user',
            text: text.trim(),
            sentAt: new Date().toISOString(),
            userId,
          });
        } else if (
          room &&
          (room.startsWith('buddy_') || room.startsWith('consultation_')) &&
          type
        ) {
          // Video-call / presence signaling (presence_ping/pong/leave,
          // call_request/accept/decline/end, webrtc_offer/answer/ice_candidate).
          // Used both by anonymous buddy pairings (buddy_<roomKey>) and by
          // doctor<->patient consultations (consultation_<id>) — the clinician
          // portal and the patient app join the same consultation room and speak
          // this same WebRTC signaling protocol. It's a plain shared-room
          // broadcast; we skip the sender itself to avoid it reacting to its own signal.
          // Same "must have actually joined" guard as the 'message' branch
          // above — the room-membership check already happened at 'join'.
          if (!userId || !clientMetadata.get(ws)?.rooms.has(room)) return;

          logger.info('ws_signal_relay', { userId, room, signalType: type });

          if (rooms.has(room)) {
            const forwarded = JSON.stringify(parsedMessage);
            for (const client of rooms.get(room)) {
              if (client !== ws && client.readyState === 1) client.send(forwarded);
            }
          }
        }
      } catch (err) {
        logger.error('ws_message_error', { error: err.message });
      }
    });

    ws.on('close', () => {
      logger.info('ws_disconnected', { userId });
      const metadata = clientMetadata.get(ws);
      if (metadata) {
        for (const room of metadata.rooms) {
          if (rooms.has(room)) {
            rooms.get(room).delete(ws);
            if (rooms.get(room).size === 0) {
              rooms.delete(room);
            }
          }
        }
        clientMetadata.delete(ws);
      }
    });
  });

  logger.info('ws_server_initialized', {
    message: 'WebSocket Server initialized and attached to HTTP Server',
  });
  return wss;
};

/**
 * Closes every open socket belonging to `userId` — called when an account is
 * suspended, deleted or purged (utils/accountLifecycle.js), so it stops
 * receiving buddy/partner/consultation traffic immediately rather than when
 * the client next reconnects. The 'close' handler tears down room membership.
 */
export const disconnectUser = (userId) => {
  if (!userId) return 0;
  let closed = 0;
  for (const [client, metadata] of clientMetadata) {
    if (String(metadata.userId) === String(userId)) {
      try {
        client.close(4001, 'Account unavailable');
      } catch (err) {
        logger.warn('ws_disconnect_user_failed', { userId, error: err.message });
      }
      closed += 1;
    }
  }
  if (closed > 0) logger.info('ws_user_disconnected', { userId, sockets: closed });
  return closed;
};

/**
 * Broadcasts a message to all clients in a specific room
 * @param {string} room - Room name
 * @param {object} payload - Data to send
 */
export const broadcastToRoom = (room, payload) => {
  if (!rooms.has(room)) {
    return;
  }

  const clients = rooms.get(room);
  const data = JSON.stringify({
    type: 'message',
    room,
    ...payload,
  });

  for (const client of clients) {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      client.send(data);
    }
  }
};
