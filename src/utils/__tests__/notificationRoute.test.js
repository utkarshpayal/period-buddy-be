import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidNotificationRoute,
  parseNotificationRoute,
  parseNotificationExtras,
  parseNotificationData,
} from '../notificationRoute.js';

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

test('parseNotificationExtras accepts a listed icon and an https image', () => {
  assert.deepEqual(
    parseNotificationExtras({ icon: 'gift', image: ' https://cdn.example.com/a.jpg ' }),
    { extras: { icon: 'gift', image: 'https://cdn.example.com/a.jpg' } },
  );
  assert.deepEqual(parseNotificationExtras({ icon: '', image: null }), { extras: {} });
  assert.deepEqual(parseNotificationExtras(), { extras: {} });
});

test('parseNotificationExtras rejects unknown icons and non-https images', () => {
  assert.ok(parseNotificationExtras({ icon: 'skull' }).error);
  assert.ok(parseNotificationExtras({ image: 'http://example.com/a.jpg' }).error);
  assert.ok(parseNotificationExtras({ image: 'javascript:alert(1)' }).error);
  assert.ok(parseNotificationExtras({ image: 'not a url' }).error);
});

test('parseNotificationData combines route, icon and image, omitting unset ones', () => {
  assert.deepEqual(parseNotificationData({ route: '/tracker', icon: 'water' }), {
    data: { route: '/tracker', icon: 'water' },
  });
  assert.deepEqual(parseNotificationData({}), { data: undefined });
  assert.ok(parseNotificationData({ route: 'https://evil.example' }).error);
  assert.ok(parseNotificationData({ icon: 'nope' }).error);
});
