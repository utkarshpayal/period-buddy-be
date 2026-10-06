/* eslint-disable no-console -- a CLI tool: its output is the point. */
/**
 * Live check that the Jitsi server enforces tokens (infra/jitsi/README.md
 * "Verify enforcement"). Prints join links for one throw-away room:
 *
 *   valid-moderator / valid-participant  → must join (moderator gets the star)
 *   wrong-room                           → must be refused (token is for another room)
 *   expired                              → must be refused
 *   wrong-secret                         → must be refused
 *   no-token                             → must be refused (no anonymous access)
 *
 * Run on a trusted machine with the backend's JITSI_* env loaded:
 *   node --env-file=.env src/scripts/jitsiTokenCheck.js
 * The links contain live tokens for a throw-away room: don't paste them anywhere.
 */
import jwt from 'jsonwebtoken';
import { getVideoConfig, newRoomName, signJitsiToken } from '../utils/videoCall.js';

const config = getVideoConfig();
if (!config.configured) {
  console.error('Set JITSI_DOMAIN, JITSI_APP_ID and JITSI_APP_SECRET (32+ chars) first.');
  process.exit(1);
}

const room = newRoomName();
const otherRoom = newRoomName();
const link = (token) => `https://${config.domain}/${room}${token ? `?jwt=${token}` : ''}`;
const sign = (role, overrides = {}, now = new Date()) =>
  signJitsiToken(
    { roomName: overrides.roomName || room, role, user: { id: `check-${role}`, name: role } },
    { ...config, ...overrides.config },
    now,
  ).token;

const expired = sign('participant', {}, new Date(Date.now() - 2 * 3600 * 1000));
const wrongSecret = sign('participant', { config: { appSecret: `${config.appSecret}-wrong` } });
const noRoomClaim = (() => {
  const claims = jwt.decode(sign('participant'));
  delete claims.room;
  return jwt.sign(claims, config.appSecret, { algorithm: 'HS256' });
})();

const cases = [
  ['valid-moderator (must join, moderator)', link(sign('moderator'))],
  ['valid-participant (must join, not moderator)', link(sign('participant'))],
  ['wrong-room (must be refused)', link(sign('participant', { roomName: otherRoom }))],
  ['expired (must be refused)', link(expired)],
  ['wrong-secret (must be refused)', link(wrongSecret)],
  ['no-room-claim (must be refused)', link(noRoomClaim)],
  ['no-token (must be refused)', link(null)],
];

console.log(`Room: ${room}\n`);
for (const [label, url] of cases) console.log(`${label}\n  ${url}\n`);
