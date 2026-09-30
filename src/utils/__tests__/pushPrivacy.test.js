import test from 'node:test';
import assert from 'node:assert/strict';
import { PRIVATE_PUSH, hidesNotificationDetails, pushFor } from '../privacy.js';
import { splitTokensByPrivacy } from '../pushBroadcastWorker.js';

const push = {
  title: 'Period due',
  body: 'In 2 days',
  data: { route: '/tracker', image: 'https://x/y.png' },
};
const shows = { privacySettings: { hideNotificationDetails: false } };

test('hidesNotificationDetails: on unless turned off', () => {
  assert.equal(hidesNotificationDetails({}), true);
  assert.equal(hidesNotificationDetails(null), true);
  assert.equal(
    hidesNotificationDetails({ privacySettings: { hideNotificationDetails: true } }),
    true,
  );
  assert.equal(hidesNotificationDetails(shows), false);
});

test('pushFor: neutral text and no image when hidden, untouched otherwise', () => {
  assert.deepEqual(pushFor({}, push), { ...PRIVATE_PUSH, data: { route: '/tracker' } });
  assert.deepEqual(pushFor(shows, push), push);
  assert.deepEqual(pushFor({}, { title: 'a', body: 'b' }), { ...PRIVATE_PUSH, data: {} });
});

test('splitTokensByPrivacy: groups, dedupes, hidden wins on a shared device', () => {
  const users = [
    { notificationToken: 'a', ...shows },
    { notificationToken: 'a', ...shows },
    { notificationToken: 'b' },
    { notificationToken: 'c', ...shows },
    { notificationToken: 'c' },
    { notificationToken: 'd', notificationsEnabled: false, ...shows },
    { notificationToken: null, ...shows },
  ];
  assert.deepEqual(splitTokensByPrivacy(users), { open: ['a'], hidden: ['b', 'c'] });
});
