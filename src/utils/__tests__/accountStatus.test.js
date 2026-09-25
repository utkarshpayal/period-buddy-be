import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSuspended,
  shouldSendSuspensionNotice,
  SUSPENSION_NOTICE_INTERVAL_MS,
} from '../accountStatus.js';

test('an inactive account is suspended', () => {
  assert.equal(isSuspended({ isActive: false, email: 'a@b.com' }), true);
});

test('active, missing, and self-deleted accounts are not suspended', () => {
  assert.equal(isSuspended({ isActive: true, email: 'a@b.com' }), false);
  assert.equal(isSuspended(null), false);
  assert.equal(isSuspended({ isActive: false, email: 'deleted_123_a@b.com' }), false);
});

test('notice is sent the first time and then at most once per interval', () => {
  const now = Date.now();
  assert.equal(shouldSendSuspensionNotice({}, now), true);
  assert.equal(
    shouldSendSuspensionNotice({ suspensionNoticeSentAt: new Date(now - 60_000) }, now),
    false,
  );
  assert.equal(
    shouldSendSuspensionNotice(
      { suspensionNoticeSentAt: new Date(now - SUSPENSION_NOTICE_INTERVAL_MS) },
      now,
    ),
    true,
  );
});
