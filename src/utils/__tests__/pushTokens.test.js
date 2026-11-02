import test from 'node:test';
import assert from 'node:assert/strict';
import { isWebTokenRequest, pushTokensOf } from '../pushTokens.js';

test('pushTokensOf: phone first, then browsers, deduped, blanks dropped', () => {
  assert.deepEqual(
    pushTokensOf({ notificationToken: 'p', webPushTokens: ['w1', 'p', '', 'w2', 'w1'] }),
    ['p', 'w1', 'w2'],
  );
  assert.deepEqual(pushTokensOf({ webPushTokens: ['w'] }), ['w']);
  assert.deepEqual(pushTokensOf({ notificationToken: 'p' }), ['p']);
  assert.deepEqual(pushTokensOf({}), []);
  assert.deepEqual(pushTokensOf(null), []);
});

test('isWebTokenRequest: only an explicit platform "web"', () => {
  assert.equal(isWebTokenRequest({ token: 't', platform: 'web' }), true);
  for (const body of [{ token: 't' }, { platform: 'android' }, { platform: 'WEB' }, null, 'web']) {
    assert.equal(isWebTokenRequest(body), false, JSON.stringify(body));
  }
});
