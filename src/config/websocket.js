import { WebSocketServer } from 'ws';
import url from 'url';
import { verifyToken } from '../utils/jwt.js';
import logger from '../utils/logger.js';

// Global map to track active rooms and client connections
// Room Name -> Set of WebSocket clients
const rooms = new Map();

// Map of WebSocket client to metadata (e.g. userId, rooms joined)
const clientMetadata = new Map();

/**
 * Initializes the WebSocket Server
 * @param {object} server - HTTP Server instance
 */
export const initWebSocket = (server) => {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (request, socket, head) => {
    const parsedUrl = url.parse(request.url, true);
    const token = parsedUrl.query.token;

    let userId = null;
    const hasToken = token && token !== 'null' && token !== 'undefined' && token.trim() !== '';
    if (hasToken) {
      try {
        const decoded = verifyToken(token);
        userId = decoded.userId;
      } catch (err) {
        logger.warn('ws_auth_failed', { message: 'Failed to verify token on upgrade', error: err.message });
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

    ws.on('message', (message) => {
      try {
        const parsedMessage = JSON.parse(message);
        const { type, room, text } = parsedMessage;

        if (type === 'join') {
          if (!room) return;
          
          // Join room
          if (!rooms.has(room)) {
            rooms.set(room, new Set());
          }
          rooms.get(room).add(ws);
          clientMetadata.get(ws).rooms.add(room);
          
          logger.info('ws_room_joined', { userId, room });
          
          ws.send(JSON.stringify({
            type: 'joined',
            room,
            message: `Successfully joined room: ${room}`
          }));
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
          
          ws.send(JSON.stringify({
            type: 'left',
            room,
            message: `Successfully left room: ${room}`
          }));
        } else if (type === 'message') {
          if (!room || !text?.trim()) return;

          logger.info('ws_message_received', { userId, room, text: text.substring(0, 50) });

          // Broadcast to the room
          broadcastToRoom(room, {
            sender: 'user',
            text: text.trim(),
            sentAt: new Date().toISOString(),
            userId
          });
        } else if (room && room.startsWith('buddy_') && type) {
          // Period Buddy presence/video-call signaling (presence_ping/pong/leave,
          // call_request/accept/decline/end, webrtc_offer/answer/ice_candidate).
          // Both sides of a pairing join the same buddy_<roomKey> room (roomKey is
          // unique per pairing — see BuddyMatch.roomKey), so this is a plain shared-room
          // broadcast; we just skip the sender itself to avoid it reacting to its own signal.
          if (!userId) return;

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

  logger.info('ws_server_initialized', { message: 'WebSocket Server initialized and attached to HTTP Server' });
  return wss;
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
    ...payload
  });

  for (const client of clients) {
    if (client.readyState === 1) { // WebSocket.OPEN
      client.send(data);
    }
  }
};
