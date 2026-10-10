import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canMoveReferral,
  compareCreditUse,
  creditExpiryFor,
  creditState,
  intInRange,
  remainingOnCredit,
  shouldUseFreeSession,
  statusFields,
  summarizeCredits,
  validateReferralInput,
} from '../referralMath.js';

const NOW = new Date('2026-10-10T10:00:00Z');

test('validateReferralInput: cleans and checks the form', () => {
  const { value } = validateReferralInput({
    name: '  Dr  Asha   Rao ',
    email: ' Asha@Example.COM ',
    phone: '+91 98765 43210',
    note: ' met at a conference ',
  });
  assert.deepEqual(value, {
    name: 'Dr Asha Rao',
    email: 'asha@example.com',
    phone: '+91 98765 43210',
    note: 'met at a conference',
  });
  assert.ok(validateReferralInput({ name: 'A', email: 'a@b.co' }).error);
  assert.ok(validateReferralInput({ name: 'Asha', email: 'not-an-email' }).error);
  assert.ok(validateReferralInput({ name: 'Asha', email: 'a@b.co', phone: 'call me' }).error);
  assert.deepEqual(validateReferralInput({ name: 'Asha', email: 'a@b.co' }).value, {
    name: 'Asha',
    email: 'a@b.co',
  });
});

test('referral transitions: only forward, terminal states stay put', () => {
  assert.ok(canMoveReferral('submitted', 'invited'));
  assert.ok(canMoveReferral('submitted', 'withdrawn'));
  assert.ok(canMoveReferral('invited', 'onboarded'));
  assert.ok(canMoveReferral('invited', 'cancelled'));
  assert.equal(canMoveReferral('invited', 'withdrawn'), false);
  assert.equal(canMoveReferral('onboarded', 'cancelled'), false);
  assert.equal(canMoveReferral('rejected', 'invited'), false);
  assert.equal(canMoveReferral('nope', 'invited'), false);
});

test('statusFields keeps isLive in step', () => {
  assert.deepEqual(statusFields('invited'), { status: 'invited', isLive: true });
  assert.deepEqual(statusFields('onboarded'), { status: 'onboarded', isLive: true });
  assert.deepEqual(statusFields('rejected'), { status: 'rejected', isLive: false });
  assert.deepEqual(statusFields('withdrawn'), { status: 'withdrawn', isLive: false });
});

test('credits: remaining and state', () => {
  const credit = { status: 'active', sessionsGranted: 5, sessionsUsed: 2, expiresAt: null };
  assert.equal(remainingOnCredit(credit, NOW), 3);
  assert.equal(creditState(credit, NOW), 'active');
  assert.equal(creditState({ ...credit, sessionsUsed: 5 }, NOW), 'used_up');
  assert.equal(remainingOnCredit({ ...credit, status: 'revoked' }, NOW), 0);
  assert.equal(creditState({ ...credit, status: 'revoked' }, NOW), 'revoked');
  const lapsed = { ...credit, expiresAt: new Date('2026-10-01T00:00:00Z') };
  assert.equal(remainingOnCredit(lapsed, NOW), 0);
  assert.equal(creditState(lapsed, NOW), 'expired');
});

test('summarizeCredits adds up every credit', () => {
  const summary = summarizeCredits(
    [
      {
        status: 'active',
        sessionsGranted: 5,
        sessionsUsed: 2,
        usages: [{ commissionSavedMinor: 10_000 }, { commissionSavedMinor: 5_000 }],
      },
      { status: 'revoked', sessionsGranted: 5, sessionsUsed: 1, sessionsRevoked: 4, usages: [] },
    ],
    NOW,
  );
  assert.deepEqual(summary, {
    granted: 10,
    used: 3,
    remaining: 3,
    revoked: 4,
    commissionSavedMinor: 15_000,
  });
});

test('credits are used soonest-expiring first, then oldest', () => {
  const never = { expiresAt: null, createdAt: '2026-01-01' };
  const later = { expiresAt: '2026-12-01', createdAt: '2026-02-01' };
  const soon = { expiresAt: '2026-11-01', createdAt: '2026-03-01' };
  const olderNever = { expiresAt: null, createdAt: '2025-01-01' };
  assert.deepEqual([never, later, soon, olderNever].sort(compareCreditUse), [
    soon,
    later,
    olderNever,
    never,
  ]);
});

test('creditExpiryFor', () => {
  assert.equal(creditExpiryFor(NOW, null), null);
  assert.equal(creditExpiryFor(NOW, 30).toISOString(), '2026-11-09T10:00:00.000Z');
});

test('shouldUseFreeSession: only real commission, only after the grant', () => {
  const grantedAt = new Date('2026-10-01T00:00:00Z');
  assert.ok(shouldUseFreeSession({ commissionMinor: 20_000, paidAt: NOW, grantedAt }));
  assert.equal(shouldUseFreeSession({ commissionMinor: 0, paidAt: NOW, grantedAt }), false);
  assert.equal(
    shouldUseFreeSession({
      commissionMinor: 20_000,
      paidAt: new Date('2026-09-01T00:00:00Z'),
      grantedAt,
    }),
    false,
  );
});

test('intInRange', () => {
  assert.equal(intInRange('5', 1, 50), 5);
  assert.equal(intInRange(0, 1, 50), null);
  assert.equal(intInRange(2.5, 1, 50), null);
  assert.equal(intInRange('x', 1, 50), null);
});
