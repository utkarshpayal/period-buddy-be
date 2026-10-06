import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import {
  ROOM_NAME_PATTERN,
  describeVideoCall,
  evaluateJoinAccess,
  getVideoConfig,
  joinWindowFor,
  newRoomName,
  pseudonymousId,
  signJitsiToken,
} from '../videoCall.js';

const SECRET = 'x'.repeat(48);
const env = {
  JITSI_DOMAIN: 'meet.thenura.care',
  JITSI_APP_ID: 'nura',
  JITSI_APP_SECRET: SECRET,
};
const config = getVideoConfig(env);
const now = new Date('2026-10-04T10:00:00Z');

const booking = (overrides = {}) => ({
  status: 'paid',
  paymentStatus: 'paid',
  scheduledFor: '2026-10-04T10:00:00Z',
  slotEndsAt: '2026-10-04T10:30:00Z',
  ...overrides,
});

test('config: configured only when domain, app id and a 32+ char secret are all set', () => {
  assert.equal(config.configured, true);
  assert.equal(getVideoConfig({ ...env, JITSI_APP_SECRET: 'short' }).configured, false);
  assert.equal(getVideoConfig({ ...env, JITSI_DOMAIN: '' }).configured, false);
  assert.equal(getVideoConfig({ ...env, JITSI_APP_ID: '' }).configured, false);
  assert.equal(getVideoConfig({}).configured, false);
});

test('config: defaults and clamping', () => {
  assert.equal(config.tokenTtlSeconds, 600);
  assert.equal(config.joinEarlyMinutes, 10);
  assert.equal(config.joinGraceMinutes, 30);
  assert.equal(getVideoConfig({ ...env, JITSI_TOKEN_TTL_SECONDS: '5' }).tokenTtlSeconds, 60);
  assert.equal(getVideoConfig({ ...env, JITSI_TOKEN_TTL_SECONDS: '99999' }).tokenTtlSeconds, 3600);
  assert.equal(
    getVideoConfig({ ...env, CONSULTATION_JOIN_EARLY_MINUTES: '15' }).joinEarlyMinutes,
    15,
  );
});

test('join window: early minutes before the slot to grace minutes after its end', () => {
  const { opensAt, closesAt } = joinWindowFor(booking(), config);
  assert.equal(opensAt.toISOString(), '2026-10-04T09:50:00.000Z');
  assert.equal(closesAt.toISOString(), '2026-10-04T11:00:00.000Z');
});

test('join window: a slot without an end assumes the default duration', () => {
  const { closesAt } = joinWindowFor(booking({ slotEndsAt: null }), config);
  assert.equal(closesAt.toISOString(), '2026-10-04T11:30:00.000Z');
});

test('eligible: paid or active, paid for, inside the window', () => {
  assert.equal(evaluateJoinAccess(booking(), config, now).ok, true);
  assert.equal(evaluateJoinAccess(booking({ status: 'active' }), config, now).ok, true);
  const edge = new Date('2026-10-04T09:50:00Z');
  assert.equal(evaluateJoinAccess(booking(), config, edge).ok, true);
});

test('refused: too early, with the time it opens', () => {
  const result = evaluateJoinAccess(booking(), config, new Date('2026-10-04T09:49:00Z'));
  assert.equal(result.ok, false);
  assert.equal(result.code, 'JOIN_WINDOW_NOT_OPEN');
  assert.equal(result.status, 403);
  assert.equal(result.opensAt.toISOString(), '2026-10-04T09:50:00.000Z');
});

test('refused: after the window closed', () => {
  const result = evaluateJoinAccess(booking(), config, new Date('2026-10-04T11:00:01Z'));
  assert.equal(result.code, 'JOIN_WINDOW_CLOSED');
});

test('refused: unpaid checkout, completed and cancelled sessions', () => {
  for (const status of ['pending', 'completed', 'cancelled']) {
    const result = evaluateJoinAccess(booking({ status }), config, now);
    assert.equal(result.ok, false, status);
    assert.equal(result.code, 'CONSULTATION_NOT_LIVE');
  }
});

test('refused: no confirmed payment, or a refund queued', () => {
  for (const extra of [
    { paymentStatus: 'unpaid' },
    { paymentStatus: 'failed' },
    { paymentStatus: 'refunded' },
    { refundStatus: 'required' },
  ]) {
    const result = evaluateJoinAccess(booking(extra), config, now);
    assert.equal(result.code, 'PAYMENT_REQUIRED', JSON.stringify(extra));
  }
});

test('legacy booking without a slot is joinable while live', () => {
  const result = evaluateJoinAccess(booking({ scheduledFor: null, slotEndsAt: null }), config, now);
  assert.equal(result.ok, true);
  assert.equal(result.closesAt, null);
});

test('room names are random, lowercase and 128-bit', () => {
  const a = newRoomName();
  const b = newRoomName();
  assert.match(a, ROOM_NAME_PATTERN);
  assert.notEqual(a, b);
});

test('token: scoped to one room and one person, signed HS256 with the app secret', () => {
  const roomName = newRoomName();
  const { token, expiresAt } = signJitsiToken(
    { roomName, role: 'participant', user: { id: 'u1', name: 'Asha' } },
    config,
    now,
  );
  const claims = jwt.verify(token, SECRET, { algorithms: ['HS256'], clockTimestamp: now / 1000 });
  assert.equal(claims.room, roomName);
  assert.equal(claims.aud, 'jitsi');
  assert.equal(claims.iss, 'nura');
  assert.equal(claims.sub, 'meet.thenura.care');
  assert.equal(claims.context.user.id, 'u1');
  assert.equal(claims.context.user.affiliation, 'member');
  assert.equal(claims.context.user.moderator, false);
  assert.equal(claims.context.features.recording, false);
  assert.equal(claims.context.features.livestreaming, false);
  assert.equal(claims.exp - claims.iat, 600);
  assert.equal(expiresAt.getTime(), claims.exp * 1000);
  assert.ok(claims.jti);
});

test('token: the doctor is the owner (moderator)', () => {
  const { token } = signJitsiToken(
    { roomName: newRoomName(), role: 'moderator', user: { id: 'd1', name: 'Dr Rao' } },
    config,
    now,
  );
  const claims = jwt.decode(token);
  assert.equal(claims.context.user.affiliation, 'owner');
  assert.equal(claims.context.user.moderator, true);
});

test('token: expiry is capped at the join window close', () => {
  const closesAt = new Date(now.getTime() + 120_000);
  const { token } = signJitsiToken(
    { roomName: newRoomName(), role: 'participant', user: { id: 'u1' }, closesAt },
    config,
    now,
  );
  assert.equal(jwt.decode(token).exp * 1000, closesAt.getTime());
});

test('token: an expired token fails verification', () => {
  const { token } = signJitsiToken(
    { roomName: newRoomName(), role: 'participant', user: { id: 'u1' } },
    config,
    now,
  );
  assert.throws(
    () => jwt.verify(token, SECRET, { clockTimestamp: now / 1000 + 601 }),
    /jwt expired/,
  );
});

test('token: a token signed with another secret fails verification', () => {
  const { token } = signJitsiToken(
    { roomName: newRoomName(), role: 'participant', user: { id: 'u1' } },
    getVideoConfig({ ...env, JITSI_APP_SECRET: 'y'.repeat(48) }),
    now,
  );
  assert.throws(() => jwt.verify(token, SECRET), /invalid signature/);
});

test('token: refuses a malformed room name or role', () => {
  assert.throws(() =>
    signJitsiToken(
      { roomName: 'consultation_abc', role: 'participant', user: { id: 'u' } },
      config,
    ),
  );
  assert.throws(() =>
    signJitsiToken({ roomName: newRoomName(), role: 'admin', user: { id: 'u' } }, config),
  );
});

test('describeVideoCall: summary for live sessions, null otherwise', () => {
  const summary = describeVideoCall(booking(), config, now);
  assert.deepEqual(summary, {
    available: true,
    joinOpensAt: '2026-10-04T09:50:00.000Z',
    joinClosesAt: '2026-10-04T11:00:00.000Z',
    canJoinNow: true,
  });
  assert.equal(describeVideoCall(booking({ status: 'completed' }), config, now), null);
  const off = describeVideoCall(booking(), getVideoConfig({}), now);
  assert.equal(off.available, false);
  assert.equal(off.canJoinNow, false);
});

test('pseudonymous ids are stable per room and differ across rooms and users', () => {
  const a = pseudonymousId('user1', 'match1', SECRET);
  assert.equal(a, pseudonymousId('user1', 'match1', SECRET));
  assert.notEqual(a, pseudonymousId('user1', 'match2', SECRET));
  assert.notEqual(a, pseudonymousId('user2', 'match1', SECRET));
  assert.equal(a.includes('user1'), false);
});
