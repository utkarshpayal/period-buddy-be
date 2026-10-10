import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_REFUND_ATTEMPTS,
  autoRefundsEnabled,
  outcomeOf,
  refundIdFor,
  retryDelayMs,
} from '../consultationRefunds.js';

test('refund ids are fixed per consultation, with a round suffix after a cancelled one', () => {
  assert.equal(refundIdFor('6ac7c88a46ffaa802958c4ab'), 'refund_6ac7c88a46ffaa802958c4ab');
  assert.equal(refundIdFor('6ac7c88a46ffaa802958c4ab', 2), 'refund_6ac7c88a46ffaa802958c4ab_2');
  // Cashfree allows up to 40 characters.
  assert.ok(refundIdFor('6ac7c88a46ffaa802958c4ab', 5).length <= 40);
});

test('Cashfree SUCCESS finishes the refund with the bank reference', () => {
  const o = outcomeOf({
    refund_status: 'SUCCESS',
    cf_refund_id: 98765,
    refund_arn: 'ARN123',
    refund_id: 'refund_x',
  });
  assert.equal(o.status, 'success');
  assert.equal(o.reference, 'ARN123');
  assert.equal(o.cfRefundId, '98765');
  assert.equal(outcomeOf({ refund_status: 'SUCCESS', cf_refund_id: 5 }).reference, '5');
});

test('PENDING and ONHOLD wait; CANCELLED is a failure with its reason', () => {
  assert.equal(outcomeOf({ refund_status: 'PENDING' }).status, 'pending');
  assert.equal(outcomeOf({ refund_status: 'ONHOLD' }).status, 'pending');
  assert.equal(outcomeOf({}).status, 'pending');
  const cancelled = outcomeOf({
    refund_status: 'CANCELLED',
    status_description: 'Insufficient balance',
  });
  assert.equal(cancelled.status, 'failed');
  assert.equal(cancelled.error, 'Insufficient balance');
});

test('retries back off and stop after the last attempt', () => {
  assert.equal(retryDelayMs(1), 2 * 60_000);
  assert.equal(retryDelayMs(2), 15 * 60_000);
  assert.equal(retryDelayMs(3), 60 * 60_000);
  assert.equal(retryDelayMs(4), 6 * 60 * 60_000);
  assert.equal(retryDelayMs(MAX_REFUND_ATTEMPTS), null);
});

test('automatic refunds need Cashfree keys and can be switched off', () => {
  const saved = { ...process.env };
  try {
    delete process.env.CASHFREE_APP_ID;
    delete process.env.CASHFREE_SECRET_KEY;
    assert.equal(autoRefundsEnabled(), false);
    process.env.CASHFREE_APP_ID = 'id';
    process.env.CASHFREE_SECRET_KEY = 'secret';
    delete process.env.CASHFREE_AUTO_REFUNDS;
    assert.equal(autoRefundsEnabled(), true);
    process.env.CASHFREE_AUTO_REFUNDS = 'false';
    assert.equal(autoRefundsEnabled(), false);
  } finally {
    process.env = saved;
  }
});
