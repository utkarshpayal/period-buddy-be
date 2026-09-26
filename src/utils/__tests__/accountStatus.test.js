import test from 'node:test';
import assert from 'node:assert/strict';
import {
  accountStateOf,
  deletedEmailFor,
  isDeletedAccount,
  isSuspended,
  originalEmailOf,
  shouldSendSuspensionNotice,
  SUSPENSION_NOTICE_INTERVAL_MS,
} from '../accountStatus.js';
import { isSelfDeletionBlocked } from '../accountLifecycle.js';

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

test('an account with deletedAt is deleted, not suspended, even with a normal email', () => {
  const user = { isActive: false, email: 'a@b.com', deletedAt: new Date() };
  assert.equal(isDeletedAccount(user), true);
  assert.equal(isSuspended(user), false);
  assert.equal(accountStateOf(user), 'deleted');
});

test('account state distinguishes active, suspended and legacy-deleted accounts', () => {
  assert.equal(accountStateOf({ isActive: true, email: 'a@b.com' }), 'active');
  assert.equal(accountStateOf({ isActive: false, email: 'a@b.com' }), 'suspended');
  assert.equal(accountStateOf({ isActive: false, email: 'deleted_1_a@b.com' }), 'deleted');
});

test('the renamed email of a deleted account round-trips to the original', () => {
  const id = '65a1b2c3d4e5f60718293a4b';
  const renamed = deletedEmailFor(id, 'someone@example.com');
  assert.equal(renamed, `deleted_${id}_someone@example.com`);
  assert.equal(originalEmailOf({ email: renamed }), 'someone@example.com');
  assert.equal(originalEmailOf({ email: 'plain@example.com' }), 'plain@example.com');
});

test('staff and doctors cannot self-delete; app users and partners can', () => {
  assert.equal(isSelfDeletionBlocked({ role: 'admin' }), true);
  assert.equal(isSelfDeletionBlocked({ role: 'content_admin' }), true);
  assert.equal(isSelfDeletionBlocked({ role: 'doctor' }), true);
  assert.equal(isSelfDeletionBlocked({ role: 'user' }), false);
  assert.equal(isSelfDeletionBlocked({ role: 'partner' }), false);
});
