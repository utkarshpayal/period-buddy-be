import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidNotificationRoute, parseNotificationRoute } from '../notificationRoute.js';

test('accepts plain in-app paths, with or without a query', () => {
  for (const r of [
    '/tracker',
    '/notifications',
    '/blogs?slug=my-post',
    '/community?postId=abc123',
    '/(app)/insights',
  ]) {
    assert.equal(isValidNotificationRoute(r), true, r);
  }
});

test('rejects full URLs, protocol-relative and traversal paths', () => {
  for (const r of [
    'https://evil.com',
    '//evil.com',
    'tracker',
    '/../x',
    'javascript:alert(1)',
    '/a b',
    '/x#frag',
  ]) {
    assert.equal(isValidNotificationRoute(r), false, r);
  }
});

test('parseNotificationRoute treats empty as "no route"', () => {
  assert.deepEqual(parseNotificationRoute(undefined), {});
  assert.deepEqual(parseNotificationRoute('  '), {});
  assert.deepEqual(parseNotificationRoute(' /tracker '), { route: '/tracker' });
  assert.ok(parseNotificationRoute('https://x.com').error);
  assert.ok(parseNotificationRoute(42).error);
});
