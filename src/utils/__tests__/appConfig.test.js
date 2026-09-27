import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bannerStatus,
  isColor,
  mergeFeatures,
  mergeHomeSections,
  parseBannerInput,
  parseFeatures,
  parseHomeSections,
  parseTheme,
} from '../appConfig.js';
import { FEATURE_CATALOG, HOME_SECTIONS } from '../../constants/appCatalog.js';

test('isColor accepts hex and rgb(a), rejects anything else', () => {
  for (const c of ['#fff', '#E8618F', '#E8618F80', 'rgb(1, 2, 3)', 'rgba(242, 143, 176, 0.18)']) {
    assert.equal(isColor(c), true, c);
  }
  for (const c of ['red', '#ggg', 'rgba(300, 0, 0, 1)', 'url(x)', '', null, 12]) {
    assert.equal(isColor(c), false, String(c));
  }
});

test('mergeFeatures with nothing saved is the catalog as shipped', () => {
  const merged = mergeFeatures();
  assert.equal(merged.length, FEATURE_CATALOG.length);
  const predictions = merged.find((f) => f.key === 'predictions');
  assert.equal(predictions.enabled, true);
  assert.equal(predictions.placement, 'care_hub');
  assert.equal(predictions.title, 'Predictions');
  assert.equal(predictions.badge, null);
});

test('mergeFeatures applies overrides and ignores keys the catalog dropped', () => {
  const merged = mergeFeatures([
    { key: 'blogs', enabled: false, placement: 'care_hub', order: 0, title: 'Read', badge: 'NEW' },
    { key: 'retiredFeature', enabled: true, placement: 'care_hub', order: 1 },
  ]);
  const blogs = merged.find((f) => f.key === 'blogs');
  assert.equal(blogs.enabled, false);
  assert.equal(blogs.placement, 'care_hub');
  assert.equal(blogs.title, 'Read');
  assert.equal(blogs.defaults.title, 'Blogs');
  assert.equal(blogs.badge, 'NEW');
  assert.equal(
    merged.some((f) => f.key === 'retiredFeature'),
    false,
  );
});

test('parseFeatures validates keys, placements and text lengths', () => {
  const ok = parseFeatures([
    {
      key: 'forest',
      enabled: false,
      placement: 'wellness_hub',
      order: 2,
      size: 'large',
      badge: ' ',
    },
  ]);
  assert.deepEqual(ok.features[0], {
    key: 'forest',
    enabled: false,
    placement: 'wellness_hub',
    size: 'large',
    colorKey: 'success',
    order: 2,
    title: null,
    description: null,
    badge: null,
    audience: { segment: 'all', platforms: [], minAppVersion: null, maxAppVersion: null },
  });
  assert.ok(parseFeatures('nope').error);
  assert.ok(parseFeatures([{ key: 'nope', placement: 'care_hub', order: 0 }]).error);
  assert.ok(parseFeatures([{ key: 'forest', placement: 'sidebar', order: 0 }]).error);
  assert.ok(
    parseFeatures([{ key: 'forest', placement: 'care_hub', order: 0, colorKey: 'red' }]).error,
  );
  assert.ok(
    parseFeatures([{ key: 'forest', placement: 'care_hub', order: 0, title: 'x'.repeat(41) }])
      .error,
  );
  assert.ok(
    parseFeatures([
      { key: 'forest', placement: 'care_hub', order: 0 },
      { key: 'forest', placement: 'care_hub', order: 1 },
    ]).error,
  );
});

test('home sections merge in saved order and keep unsaved ones', () => {
  const parsed = parseHomeSections([
    { key: 'insights', visible: false, order: 0 },
    { key: 'statPills', visible: true, order: 1 },
  ]);
  assert.equal(parsed.sections.length, 2);
  const merged = mergeHomeSections(parsed.sections);
  assert.equal(merged.length, HOME_SECTIONS.length);
  assert.equal(merged[0].key, 'insights');
  assert.equal(merged[0].visible, false);
  assert.ok(parseHomeSections([{ key: 'nope', order: 0 }]).error);
});

test('parseTheme keeps valid known tokens and drops empty ones', () => {
  const { theme } = parseTheme({ light: { primary: '#123456', accent: '' }, dark: {} });
  assert.deepEqual(theme, { light: { primary: '#123456' }, dark: {} });
  assert.ok(parseTheme({ light: { danger: '#000' } }).error);
  assert.ok(parseTheme({ light: { primary: 'javascript:alert(1)' } }).error);
});

test('parseBannerInput validates the tap action and schedule', () => {
  const ok = parseBannerInput({
    title: 'Monsoon sale',
    placement: 'home_top',
    action: { type: 'route', value: '/subscription' },
    startAt: '2026-10-01T00:00:00Z',
    endAt: '2026-10-10T00:00:00Z',
  });
  assert.equal(ok.banner.action.value, '/subscription');
  assert.equal(ok.banner.layout, 'card');
  assert.ok(parseBannerInput({ placement: 'home_top' }).error);
  assert.ok(parseBannerInput({ title: 'x', placement: 'sidebar' }).error);
  assert.ok(
    parseBannerInput({
      title: 'x',
      placement: 'home_top',
      action: { type: 'route', value: 'https://evil.com' },
    }).error,
  );
  assert.ok(
    parseBannerInput({
      title: 'x',
      placement: 'home_top',
      action: { type: 'url', value: 'http://insecure.com' },
    }).error,
  );
  assert.ok(parseBannerInput({ title: 'x', placement: 'home_top', layout: 'image' }).error);
  assert.ok(
    parseBannerInput({
      title: 'x',
      placement: 'home_top',
      startAt: '2026-10-10',
      endAt: '2026-10-01',
    }).error,
  );
});

test('bannerStatus', () => {
  const now = new Date('2026-10-05T00:00:00Z');
  assert.equal(bannerStatus({ active: false }, now), 'inactive');
  assert.equal(bannerStatus({ active: true, startAt: '2026-10-06T00:00:00Z' }, now), 'scheduled');
  assert.equal(bannerStatus({ active: true, endAt: '2026-10-04T00:00:00Z' }, now), 'expired');
  assert.equal(bannerStatus({ active: true }, now), 'live');
});

test('parseAction: routes, websites and other apps', async () => {
  const { parseAction } = await import('../appConfig.js');
  const all = ['none', 'route', 'url', 'app'];
  assert.deepEqual(parseAction({ type: 'route', value: '/tracker' }, all).action, {
    type: 'route',
    value: '/tracker',
    fallbackUrl: null,
  });
  assert.equal(
    parseAction(
      {
        type: 'app',
        value: 'whatsapp://send?phone=911234567890',
        fallbackUrl: 'https://wa.me/911234567890',
      },
      all,
    ).action.fallbackUrl,
    'https://wa.me/911234567890',
  );
  for (const bad of [
    { type: 'app', value: 'javascript:alert(1)' },
    { type: 'app', value: 'data:text/html,hi' },
    { type: 'app', value: 'whatsapp://x', fallbackUrl: 'http://insecure' },
    { type: 'url', value: 'http://insecure.com' },
    { type: 'route', value: 'https://evil.com' },
    { type: 'teleport', value: 'x' },
  ]) {
    assert.ok(parseAction(bad, all).error, JSON.stringify(bad));
  }
  assert.ok(parseAction({ type: 'none' }, ['route', 'url', 'app']).error);
});

test('parseAudience', async () => {
  const { parseAudience } = await import('../appConfig.js');
  assert.equal(parseAudience(undefined).audience.segment, 'all');
  assert.deepEqual(
    parseAudience({ segment: 'premium', platforms: ['android'], minAppVersion: '1.2' }).audience,
    { segment: 'premium', platforms: ['android'], minAppVersion: '1.2', maxAppVersion: null },
  );
  assert.deepEqual(parseAudience({ platforms: ['android', 'ios', 'web'] }).audience.platforms, []);
  assert.ok(parseAudience({ segment: 'vip' }).error);
  assert.ok(parseAudience({ platforms: ['windows'] }).error);
  assert.ok(parseAudience({ minAppVersion: '2.0', maxAppVersion: '1.0' }).error);
  assert.ok(parseAudience({ minAppVersion: 'latest' }).error);
});

test('parseCustomTiles validates and assigns ids', async () => {
  const { parseCustomTiles } = await import('../appConfig.js');
  const base = {
    title: 'Join our WhatsApp',
    icon: 'logo-whatsapp',
    colorKey: 'success',
    placement: 'explore_hub',
    size: 'small',
    order: 3,
    action: { type: 'app', value: 'whatsapp://send?phone=91', fallbackUrl: 'https://wa.me/91' },
  };
  const { tiles } = parseCustomTiles([base]);
  assert.match(tiles[0].id, /^[a-f0-9]{12}$/);
  assert.equal(parseCustomTiles([{ ...base, id: 'keepme123' }]).tiles[0].id, 'keepme123');
  assert.ok(parseCustomTiles([{ ...base, title: '' }]).error);
  assert.ok(parseCustomTiles([{ ...base, icon: 'skull' }]).error);
  // No action is a Coming soon teaser; utils/launch.js stops it going live.
  assert.equal(
    parseCustomTiles([{ ...base, action: { type: 'none' } }]).tiles[0].action.type,
    'none',
  );
  assert.ok(parseCustomTiles([{ ...base, action: { type: 'url', value: 'http://x.co' } }]).error);
  assert.deepEqual(parseCustomTiles(undefined).tiles, []);
});

test('settings and version comparison', async () => {
  const { compareVersions, parseSettings } = await import('../appConfig.js');
  assert.equal(compareVersions('1.2', '1.2.0'), 0);
  assert.equal(compareVersions('1.10.0', '1.9.9'), 1);
  assert.equal(compareVersions('0.9', '1'), -1);
  const ok = parseSettings({
    maintenance: { enabled: true, message: 'Back soon' },
    update: {
      minVersion: '1.0.0',
      latestVersion: '1.2.0',
      androidUrl: 'https://play.google.com/x',
    },
  });
  assert.equal(ok.settings.maintenance.enabled, true);
  assert.equal(ok.settings.update.iosUrl, null);
  assert.ok(
    parseSettings({
      update: { minVersion: '2.0', latestVersion: '1.0', androidUrl: 'https://x.y' },
    }).error,
  );
  assert.ok(parseSettings({ update: { minVersion: '1.0' } }).error); // no store link
  assert.ok(parseSettings({ maintenance: { enabled: true, message: '' } }).error);
});
