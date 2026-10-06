import test from 'node:test';
import assert from 'node:assert/strict';
import jwt from 'jsonwebtoken';
import BuddyMatch from '../../models/BuddyMatch.js';
import Consultation from '../../models/Consultation.js';
import Doctor from '../../models/Doctor.js';
import Notification from '../../models/Notification.js';
import User from '../../models/User.js';
import {
  isSideInCall,
  joinAsDoctor,
  joinAsPatient,
  buddyPresence,
  joinBuddyCall,
  reportPatientAttendance,
} from '../videoCallController.js';

const SECRET = 'z'.repeat(48);
const PATIENT = '64b000000000000000000001';
const OTHER_USER = '64b000000000000000000002';
const DOCTOR_USER = '64b000000000000000000003';
const DOCTOR_ID = '64b0000000000000000000d1';
const OTHER_DOCTOR_ID = '64b0000000000000000000d2';
const CONSULTATION = '64b0000000000000000000c1';
const ROOM = 'nura-0123456789abcdef0123456789abcdef';

const VIDEO_ENV = {
  JITSI_DOMAIN: 'meet.thenura.care',
  JITSI_APP_ID: 'nura',
  JITSI_APP_SECRET: SECRET,
};

/** A mongoose-ish query: chainable select/populate/lean, awaitable. */
const query = (value) => {
  const q = {
    select: () => q,
    sort: () => q,
    populate: () => q,
    lean: () => q,
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  };
  return q;
};

const fakeRes = () => {
  const res = { statusCode: 200, body: null };
  res.status = (code) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body) => {
    res.body = body;
    return res;
  };
  return res;
};

/** A booking that is live right now (slot started 5 min ago). */
const liveBooking = (overrides = {}) => ({
  _id: CONSULTATION,
  userId: PATIENT,
  doctorId: DOCTOR_ID,
  status: 'paid',
  paymentStatus: 'paid',
  scheduledFor: new Date(Date.now() - 5 * 60000),
  slotEndsAt: new Date(Date.now() + 25 * 60000),
  ...overrides,
});

/**
 * Stub the models: `consultations` is the booking table the controller's
 * `findOne(filter)` is matched against, so ownership comes from the real
 * filter the controller builds, not from the stub.
 */
const setup = (t, { consultations = [liveBooking()], env = VIDEO_ENV } = {}) => {
  const saved = {};
  for (const key of Object.keys(VIDEO_ENV)) saved[key] = process.env[key];
  Object.assign(process.env, Object.fromEntries(Object.keys(VIDEO_ENV).map((k) => [k, ''])), env);
  t.after(() => Object.assign(process.env, saved));

  const updates = [];
  const matches = (row, filter) =>
    Object.entries(filter).every(([key, value]) => {
      if (key === 'status' && value?.$in) return value.$in.includes(row.status);
      if (key === '$or') return true;
      return String(row[key]) === String(value);
    });

  t.mock.method(Consultation, 'findOne', (filter) =>
    query(consultations.find((row) => matches(row, filter)) || null),
  );
  t.mock.method(Consultation, 'findById', () => query({ _id: CONSULTATION, videoRoom: ROOM }));
  t.mock.method(Consultation, 'updateOne', async (filter, update) => {
    updates.push({ filter, update });
    const hit = consultations.some((row) => matches(row, filter));
    return { matchedCount: hit ? 1 : 0, modifiedCount: hit ? 1 : 0 };
  });
  t.mock.method(Consultation, 'findOneAndUpdate', (filter, update) => {
    updates.push({ filter, update });
    return query(consultations.find((row) => matches(row, filter)) || null);
  });
  t.mock.method(Doctor, 'findById', () =>
    query({ _id: DOCTOR_ID, name: 'Dr Rao', userId: DOCTOR_USER }),
  );
  t.mock.method(Doctor, 'findOne', (filter) =>
    query(
      String(filter.userId) === DOCTOR_USER
        ? { _id: DOCTOR_ID, name: 'Dr Rao', avatarUrl: null }
        : String(filter.userId) === OTHER_USER
          ? { _id: OTHER_DOCTOR_ID, name: 'Dr Other' }
          : null,
    ),
  );
  t.mock.method(User, 'findById', () => query({ firstName: 'Asha', lastName: '' }));
  const pushes = [];
  t.mock.method(Notification, 'create', async (doc) => {
    pushes.push(doc);
    return doc;
  });
  return { updates, pushes };
};

const call = async (handler, req) => {
  const res = fakeRes();
  let failure = null;
  await handler(req, res, (err) => {
    failure = err;
  });
  if (failure) throw failure;
  return res;
};

const patientReq = (userId = PATIENT) => ({
  params: { id: CONSULTATION },
  userId,
  user: { firstName: 'Asha' },
  body: {},
});
const doctorReq = (userId = DOCTOR_USER) => ({ params: { id: CONSULTATION }, userId, body: {} });

test('the booked patient gets a participant token for this room only', async (t) => {
  const { updates } = setup(t);
  const res = await call(joinAsPatient, patientReq());
  assert.equal(res.statusCode, 200);
  const data = res.body.data;
  assert.equal(data.role, 'participant');
  assert.equal(data.roomName, ROOM);
  assert.equal(data.meetingUrl, `https://meet.thenura.care/${ROOM}`);
  const claims = jwt.verify(data.token, SECRET, { algorithms: ['HS256'] });
  assert.equal(claims.room, ROOM);
  assert.equal(claims.context.user.id, PATIENT);
  assert.equal(claims.context.user.affiliation, 'member');
  // Moves paid -> active, never to completed.
  assert.equal(updates[0].update.$set.status, 'active');
});

test('the assigned doctor gets a moderator token', async (t) => {
  setup(t);
  const res = await call(joinAsDoctor, doctorReq());
  assert.equal(res.statusCode, 200);
  const claims = jwt.verify(res.body.data.token, SECRET);
  assert.equal(res.body.data.role, 'moderator');
  assert.equal(claims.context.user.affiliation, 'owner');
  assert.equal(claims.context.user.id, DOCTOR_USER);
});

test('another patient cannot join someone else’s consultation', async (t) => {
  setup(t);
  const res = await call(joinAsPatient, patientReq(OTHER_USER));
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.data, undefined);
});

test('a doctor who is not assigned cannot join', async (t) => {
  setup(t);
  const res = await call(joinAsDoctor, doctorReq(OTHER_USER));
  assert.equal(res.statusCode, 404);
});

test('a staff/user login without a doctor profile cannot join as doctor', async (t) => {
  setup(t);
  const res = await call(joinAsDoctor, doctorReq(PATIENT));
  assert.equal(res.statusCode, 404);
});

test('too early: 403 JOIN_WINDOW_NOT_OPEN with opensAt, no token', async (t) => {
  setup(t, {
    consultations: [
      liveBooking({
        scheduledFor: new Date(Date.now() + 60 * 60000),
        slotEndsAt: new Date(Date.now() + 90 * 60000),
      }),
    ],
  });
  const res = await call(joinAsPatient, patientReq());
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'JOIN_WINDOW_NOT_OPEN');
  assert.ok(res.body.opensAt);
  assert.equal(res.body.token, undefined);
});

test('unpaid, cancelled and completed bookings get no token', async (t) => {
  for (const [overrides, code] of [
    [{ status: 'pending', paymentStatus: 'unpaid' }, 'CONSULTATION_NOT_LIVE'],
    [{ status: 'cancelled' }, 'CONSULTATION_NOT_LIVE'],
    [{ status: 'completed' }, 'CONSULTATION_NOT_LIVE'],
    [{ paymentStatus: 'unpaid' }, 'PAYMENT_REQUIRED'],
  ]) {
    await t.test(code + JSON.stringify(overrides), async (st) => {
      setup(st, { consultations: [liveBooking(overrides)] });
      const res = await call(joinAsDoctor, doctorReq());
      assert.equal(res.body.code, code);
      assert.equal(res.body.data, undefined);
    });
  }
});

test('Jitsi not configured: 503, nothing signed', async (t) => {
  setup(t, { env: { JITSI_APP_SECRET: '' } });
  const res = await call(joinAsPatient, patientReq());
  assert.equal(res.statusCode, 503);
});

test('attendance is recorded but never changes status', async (t) => {
  const { updates } = setup(t);
  const res = await call(reportPatientAttendance, { ...patientReq(), body: { event: 'left' } });
  assert.equal(res.statusCode, 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].update.$set, undefined);
  assert.ok(updates[0].update.$max['videoAttendance.patientLeftAt']);
});

test('attendance rejects unknown events and other people’s bookings', async (t) => {
  setup(t);
  const bad = await call(reportPatientAttendance, {
    ...patientReq(),
    body: { event: 'completed' },
  });
  assert.equal(bad.statusCode, 400);
  const other = await call(reportPatientAttendance, {
    ...patientReq(OTHER_USER),
    body: { event: 'joined' },
  });
  assert.equal(other.statusCode, 404);
});

/* ------------------------------ Period Buddy ------------------------------ */

const MATCH = '64b0000000000000000000b1';
const BUDDY = '64b000000000000000000004';
const ROOM_KEY = 'room-key-1';

const setupBuddy = (
  t,
  {
    match = { _id: MATCH, members: [PATIENT, BUDDY], roomKey: ROOM_KEY },
    buddyActive = true,
    online = [PATIENT, BUDDY],
    env = VIDEO_ENV,
  } = {},
) => {
  setup(t, { env });
  t.mock.method(BuddyMatch, 'findOne', (filter) =>
    query(match && match.members.map(String).includes(String(filter.members)) ? match : null),
  );
  t.mock.method(BuddyMatch, 'findById', () => query({ _id: MATCH, videoRoom: ROOM }));
  t.mock.method(BuddyMatch, 'updateOne', async () => ({ matchedCount: 1 }));
  t.mock.method(User, 'findOne', () =>
    query(buddyActive ? { firstName: 'Rose', lastName: '' } : null),
  );
  const checks = [];
  t.mock.method(buddyPresence, 'inChat', (roomKey, userId) => {
    checks.push(roomKey);
    return online.includes(String(userId));
  });
  return { checks };
};

const buddyReq = (userId = PATIENT) => ({ userId, user: { firstName: 'Asha' }, body: {} });

test('buddy: both online in the chat, participant token with a pseudonymous id', async (t) => {
  const { checks } = setupBuddy(t);
  const res = await call(joinBuddyCall, buddyReq());
  assert.equal(res.statusCode, 200);
  const claims = jwt.verify(res.body.data.token, SECRET);
  assert.equal(claims.room, ROOM);
  assert.equal(res.body.data.role, 'participant');
  assert.equal(claims.context.user.affiliation, 'member');
  assert.notEqual(claims.context.user.id, PATIENT);
  assert.equal(claims.context.user.name, 'Asha');
  assert.equal(res.body.data.peerName, 'Rose');
  assert.deepEqual(checks, [ROOM_KEY, ROOM_KEY]);
});

test('buddy: the other buddy is not in the chat, no token', async (t) => {
  setupBuddy(t, { online: [PATIENT] });
  const res = await call(joinBuddyCall, buddyReq());
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'BUDDY_OFFLINE');
  assert.match(res.body.message, /Rose is offline/);
  assert.equal(res.body.data, undefined);
});

test('buddy: the caller is not in the chat (direct API call), no token', async (t) => {
  setupBuddy(t, { online: [BUDDY] });
  const res = await call(joinBuddyCall, buddyReq());
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'BUDDY_CHAT_NOT_OPEN');
});

test('buddy: no active pairing, no token', async (t) => {
  setupBuddy(t, { match: null });
  const res = await call(joinBuddyCall, buddyReq());
  assert.equal(res.statusCode, 404);
  assert.equal(res.body.data, undefined);
});

test('buddy: someone outside the pairing gets no token', async (t) => {
  setupBuddy(t);
  const res = await call(joinBuddyCall, buddyReq(OTHER_USER));
  assert.equal(res.statusCode, 404);
});

test('buddy: the other member suspended or deleted, no token', async (t) => {
  setupBuddy(t, { buddyActive: false });
  const res = await call(joinBuddyCall, buddyReq());
  assert.equal(res.statusCode, 409);
});

test('buddy: Jitsi not configured, 503', async (t) => {
  setupBuddy(t, { env: { JITSI_APP_SECRET: '' } });
  const res = await call(joinBuddyCall, buddyReq());
  assert.equal(res.statusCode, 503);
});

test('isSideInCall: joined after the last leave', () => {
  const t0 = '2026-10-04T10:00:00Z';
  const t1 = '2026-10-04T10:05:00Z';
  assert.equal(isSideInCall(undefined, 'patient'), false);
  assert.equal(isSideInCall({ patientJoinedAt: t0 }, 'patient'), true);
  assert.equal(isSideInCall({ patientJoinedAt: t0, patientLeftAt: t1 }, 'patient'), false);
  assert.equal(isSideInCall({ patientJoinedAt: t1, patientLeftAt: t0 }, 'patient'), true);
  assert.equal(isSideInCall({ patientJoinedAt: t1 }, 'doctor'), false);
});

test('doctor joins: the waiting patient is pushed once', async (t) => {
  const id = '64b0000000000000000000c7';
  const { pushes } = setup(t, { consultations: [liveBooking({ _id: id })] });
  const res = await call(joinAsDoctor, { ...doctorReq(), params: { id } });
  assert.equal(res.statusCode, 200);
  assert.equal(pushes.length, 1);
  assert.equal(pushes[0].data.kind, 'incoming_call');
});

test('doctor rejoins while the patient is already in the call: no push', async (t) => {
  const id = '64b0000000000000000000c8';
  const { pushes } = setup(t, {
    consultations: [
      liveBooking({
        _id: id,
        status: 'active',
        videoAttendance: { patientJoinedAt: new Date(Date.now() - 60000) },
      }),
    ],
  });
  const res = await call(joinAsDoctor, { ...doctorReq(), params: { id } });
  assert.equal(res.statusCode, 200);
  assert.equal(pushes.length, 0);
});

test('attendance "joined" records the latest join', async (t) => {
  const { updates } = setup(t);
  const res = await call(reportPatientAttendance, { ...patientReq(), body: { event: 'joined' } });
  assert.equal(res.statusCode, 200);
  assert.ok(updates[0].update.$max['videoAttendance.patientJoinedAt']);
});
