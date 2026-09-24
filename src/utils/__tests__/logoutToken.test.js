import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLogoutTokenFilter, MAX_FCM_TOKEN_LENGTH } from '../logoutToken.js';

const id = 'user123';

test('scopes the unset to the sent token', () => {
  assert.deepEqual(buildLogoutTokenFilter(id, { fcmToken: 'abc:def' }), {
    _id: id,
    notificationToken: 'abc:def',
  });
});

test('trims the token like the fcm-token endpoint does when storing it', () => {
  assert.deepEqual(buildLogoutTokenFilter(id, { fcmToken: '  abc  ' }), {
    _id: id,
    notificationToken: 'abc',
  });
});

test('falls back to unconditional unset when no usable token is sent (old clients)', () => {
  for (const body of [
    undefined,
    null,
    {},
    { fcmToken: '' },
    { fcmToken: '   ' },
    { fcmToken: 123 },
    { fcmToken: { $ne: null } },
    { fcmToken: ['a'] },
    'str',
  ]) {
    assert.deepEqual(buildLogoutTokenFilter(id, body), { _id: id }, JSON.stringify(body));
  }
});

test('skips the update for an oversized token instead of wiping another device', () => {
  assert.equal(
    buildLogoutTokenFilter(id, { fcmToken: 'a'.repeat(MAX_FCM_TOKEN_LENGTH + 1) }),
    null,
  );
});
