import test from 'node:test';
import assert from 'node:assert/strict';
import {
  describeDevice,
  lockMinutesLeft,
  maskEmail,
  requiresSecondFactor,
} from '../loginSecurity.js';
import { cookieRequestAllowed, readCookie, tokenFromRequest } from '../sessionCookie.js';

test('lockMinutesLeft rounds up and is 0 once the lock has passed', () => {
  const now = new Date('2026-10-01T10:00:00Z');
  assert.equal(lockMinutesLeft(new Date('2026-10-01T10:14:01Z'), now), 15);
  assert.equal(lockMinutesLeft(new Date('2026-10-01T09:59:00Z'), now), 0);
  assert.equal(lockMinutesLeft(undefined, now), 0);
});

test('second step only for staff and doctors, only when switched on', () => {
  assert.equal(requiresSecondFactor({ role: 'admin' }, true), true);
  assert.equal(requiresSecondFactor({ role: 'content_admin' }, true), true);
  assert.equal(requiresSecondFactor({ role: 'doctor' }, true), true);
  assert.equal(requiresSecondFactor({ role: 'user' }, true), false);
  assert.equal(requiresSecondFactor({ role: 'partner' }, true), false);
  assert.equal(requiresSecondFactor({ role: 'admin' }, false), false);
});

test('maskEmail keeps the domain and two letters', () => {
  assert.equal(maskEmail('anita@thenura.care'), 'an***@thenura.care');
  assert.equal(maskEmail('a@x.io'), 'a*@x.io');
  assert.equal(maskEmail('nope'), '');
});

test('describeDevice names apps and browsers', () => {
  assert.equal(describeDevice('okhttp/4.9.2', '1.4.0'), 'Android app (v1.4.0)');
  assert.equal(
    describeDevice(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36',
    ),
    'Chrome on Windows',
  );
  assert.equal(describeDevice(''), 'An unknown device');
});

const req = ({ method = 'GET', headers = {} } = {}) => ({
  method,
  headers,
  get: (name) => headers[name.toLowerCase()],
});

test('readCookie finds one cookie among several', () => {
  const r = req({ headers: { cookie: 'a=1; nura_staff_session=abc.def; b=2' } });
  assert.equal(readCookie(r), 'abc.def');
  assert.equal(readCookie(req()), null);
});

test('tokenFromRequest: Bearer wins; the cookie only counts when switched on', () => {
  const saved = process.env.STAFF_COOKIE_AUTH;
  const r = req({ headers: { cookie: 'nura_staff_session=c1' } });
  delete process.env.STAFF_COOKIE_AUTH;
  assert.deepEqual(tokenFromRequest(r), { token: null, fromCookie: false });
  process.env.STAFF_COOKIE_AUTH = 'true';
  assert.deepEqual(tokenFromRequest(r), { token: 'c1', fromCookie: true });
  const both = req({ headers: { cookie: 'nura_staff_session=c1', authorization: 'Bearer b1' } });
  assert.deepEqual(tokenFromRequest(both), { token: 'b1', fromCookie: false });
  if (saved === undefined) delete process.env.STAFF_COOKIE_AUTH;
  else process.env.STAFF_COOKIE_AUTH = saved;
});

test('cookie CSRF check: reads pass, writes need an allowed Origin', () => {
  const saved = { NODE_ENV: process.env.NODE_ENV, ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS };
  process.env.NODE_ENV = 'production';
  process.env.ALLOWED_ORIGINS = 'https://admin.thenura.care';
  assert.equal(cookieRequestAllowed(req()), true);
  assert.equal(cookieRequestAllowed(req({ method: 'POST' })), false);
  assert.equal(
    cookieRequestAllowed(req({ method: 'POST', headers: { origin: 'https://evil.example' } })),
    false,
  );
  assert.equal(
    cookieRequestAllowed(req({ method: 'PUT', headers: { origin: 'https://admin.thenura.care' } })),
    true,
  );
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

test('scoped call tokens only reach POST /api/cycle/log', async () => {
  const { scopeAllows } = await import('../../middleware/authMiddleware.js');
  const at = (method, baseUrl, path) => ({ method, baseUrl, path });
  assert.equal(scopeAllows(undefined, at('GET', '/api/auth', '/export-data')), true);
  assert.equal(scopeAllows('checkin_call', at('POST', '/api/cycle', '/log')), true);
  assert.equal(scopeAllows('checkin_call', at('GET', '/api/auth', '/export-data')), false);
  assert.equal(scopeAllows('checkin_call', at('GET', '/api/cycle', '/log')), false);
  assert.equal(scopeAllows('checkin_webhook', at('POST', '/api/cycle', '/log')), false);
});
