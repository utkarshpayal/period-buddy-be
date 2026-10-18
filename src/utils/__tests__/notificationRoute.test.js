import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isValidNotificationRoute,
  parseNotificationRoute,
  parseNotificationExtras,
  parseNotificationData,
  isAllowedStoreUrl,
  parseNotificationStoreLink,
  wantsStoreDefaults,
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

const PLAY = 'https://play.google.com/store/apps/details?id=care.thenura.app';
const APPLE = 'https://apps.apple.com/in/app/the-nura/id123456789';

test('isAllowedStoreUrl accepts only Play Store, market:// and App Store links', () => {
  for (const url of [PLAY, 'market://details?id=care.thenura.app', APPLE]) {
    assert.equal(isAllowedStoreUrl(url), true, url);
  }
  for (const url of [
    'http://play.google.com/store/apps/details?id=x',
    'https://play.google.com.evil.com/x',
    'https://evil.com/play.google.com',
    'https://user:pw@play.google.com/x',
    'https://play.google.com:8443/x',
    'itms-apps://apps.apple.com/app/id1',
    'market://',
    'javascript:alert(1)',
    'intent://x#Intent;end',
    '/tracker',
    `https://play.google.com/${'a'.repeat(600)}`,
    '',
    null,
    42,
  ]) {
    assert.equal(isAllowedStoreUrl(url), false, String(url));
  }
});

test('parseNotificationStoreLink validates storeUrl, iosStoreUrl and kind', () => {
  assert.deepEqual(parseNotificationStoreLink({}), { link: {} });
  assert.deepEqual(parseNotificationStoreLink({ storeUrl: ` ${PLAY} ` }), {
    link: { storeUrl: PLAY },
  });
  assert.ok(parseNotificationStoreLink({ storeUrl: 'https://evil.com' }).error);
  assert.ok(parseNotificationStoreLink({ iosStoreUrl: PLAY }).error); // must be apps.apple.com
  assert.ok(parseNotificationStoreLink({ kind: 'promo' }).error);
  // An App Store link alone is also the generic storeUrl.
  assert.deepEqual(parseNotificationStoreLink({ iosStoreUrl: APPLE }).link, {
    iosStoreUrl: APPLE,
    storeUrl: APPLE,
  });
});

test('app_update pushes fall back to the App settings store links', () => {
  const defaults = { androidUrl: PLAY, iosUrl: APPLE };
  assert.equal(wantsStoreDefaults({ kind: 'app_update' }), true);
  assert.equal(wantsStoreDefaults({ kind: 'app_update', storeUrl: PLAY }), true);
  assert.equal(
    wantsStoreDefaults({ kind: 'app_update', storeUrl: PLAY, iosStoreUrl: APPLE }),
    false,
  );
  assert.equal(wantsStoreDefaults({}), false);
  assert.deepEqual(parseNotificationStoreLink({ kind: 'app_update' }, defaults).link, {
    kind: 'app_update',
    storeUrl: PLAY,
    iosStoreUrl: APPLE,
  });
  // An explicit Play link keeps iPhones on the App Store default.
  const market = 'market://details?id=care.thenura.app';
  assert.deepEqual(
    parseNotificationStoreLink({ kind: 'app_update', storeUrl: market }, defaults).link,
    { kind: 'app_update', storeUrl: market, iosStoreUrl: APPLE },
  );
  // A settings link outside the allowlist isn't used.
  assert.ok(
    parseNotificationStoreLink({ kind: 'app_update' }, { androidUrl: 'https://thenura.care' })
      .error,
  );
  assert.ok(parseNotificationStoreLink({ kind: 'app_update' }, {}).error);
});

test('parseNotificationData carries a store link but never with a route', () => {
  assert.deepEqual(parseNotificationData({ storeUrl: PLAY, icon: 'sparkles' }), {
    data: { storeUrl: PLAY, icon: 'sparkles' },
  });
  assert.ok(parseNotificationData({ storeUrl: PLAY, route: '/tracker' }).error);
  assert.deepEqual(
    parseNotificationData({ kind: 'app_update' }, { androidUrl: PLAY, iosUrl: null }),
    { data: { kind: 'app_update', storeUrl: PLAY } },
  );
});
