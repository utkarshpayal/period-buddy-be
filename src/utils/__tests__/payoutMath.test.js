import test from 'node:test';
import assert from 'node:assert/strict';
import {
  bpsToPercent,
  canTransition,
  checkWithdrawal,
  effectiveCommissionBps,
  fromMinor,
  fromStatusesFor,
  mapCashfreeTransferStatus,
  maskAccountNumber,
  maskVpa,
  percentToBps,
  releaseDateFor,
  splitCommission,
  summarizeWallet,
  toMinor,
  transferIdFor,
  validatePayoutMethodInput,
} from '../payoutMath.js';

test('toMinor/fromMinor: no float drift', () => {
  assert.equal(toMinor(499), 49_900);
  assert.equal(toMinor(0.1 + 0.2), 30);
  assert.equal(toMinor(1999.99), 199_999);
  assert.equal(toMinor('abc'), 0);
  assert.equal(fromMinor(199_999), 1999.99);
});

test('percentToBps: range and precision', () => {
  assert.equal(percentToBps(20), 2000);
  assert.equal(percentToBps(12.5), 1250);
  assert.equal(percentToBps(0), 0);
  assert.equal(percentToBps(100), 10_000);
  assert.equal(percentToBps(-1), null);
  assert.equal(percentToBps(100.01), null);
  assert.equal(percentToBps('x'), null);
  assert.equal(bpsToPercent(1250), 12.5);
});

test('splitCommission: commission + net === gross, rounded half-up', () => {
  assert.deepEqual(splitCommission(49_900, 2000), {
    grossMinor: 49_900,
    commissionBps: 2000,
    commissionMinor: 9_980,
    netMinor: 39_920,
  });
  // 333 paise at 15% = 49.95 → 50
  const odd = splitCommission(333, 1500);
  assert.equal(odd.commissionMinor, 50);
  assert.equal(odd.commissionMinor + odd.netMinor, 333);
  assert.equal(splitCommission(10_000, 0).netMinor, 10_000);
  assert.equal(splitCommission(10_000, 10_000).netMinor, 0);
  // Out-of-range rates are clamped, never produce negative net.
  assert.equal(splitCommission(10_000, 20_000).netMinor, 0);
  assert.equal(splitCommission(-5, 2000).grossMinor, 0);
});

test('effectiveCommissionBps: doctor override wins, 0% override is honoured', () => {
  const settings = { defaultCommissionBps: 2000 };
  assert.deepEqual(effectiveCommissionBps({}, settings), { bps: 2000, source: 'default' });
  assert.deepEqual(effectiveCommissionBps({ commissionBps: null }, settings), {
    bps: 2000,
    source: 'default',
  });
  assert.deepEqual(effectiveCommissionBps({ commissionBps: 0 }, settings), {
    bps: 0,
    source: 'doctor',
  });
  assert.deepEqual(effectiveCommissionBps({ commissionBps: 1500 }, settings), {
    bps: 1500,
    source: 'doctor',
  });
});

test('releaseDateFor: completion + hold days', () => {
  const at = releaseDateFor('2026-10-01T10:00:00Z', 3);
  assert.equal(at.toISOString(), '2026-10-04T10:00:00.000Z');
  assert.equal(releaseDateFor('2026-10-01T10:00:00Z', 0).toISOString(), '2026-10-01T10:00:00.000Z');
});

test('validatePayoutMethodInput: bank', () => {
  const ok = validatePayoutMethodInput({
    type: 'bank',
    accountHolderName: ' Dr. Asha  Rao ',
    accountNumber: '1234 5678 9012',
    confirmAccountNumber: '123456789012',
    ifsc: 'hdfc0001234',
  });
  assert.deepEqual(ok.value, {
    type: 'bank',
    accountHolderName: 'Dr Asha Rao',
    accountNumber: '123456789012',
    ifsc: 'HDFC0001234',
  });
  assert.match(
    validatePayoutMethodInput({
      type: 'bank',
      accountHolderName: 'A Rao',
      accountNumber: '12345678',
      ifsc: 'HDFC0001234',
    }).error,
    /9 to 18/,
  );
  assert.match(
    validatePayoutMethodInput({
      type: 'bank',
      accountHolderName: 'A Rao',
      accountNumber: '123456789',
      confirmAccountNumber: '123456780',
      ifsc: 'HDFC0001234',
    }).error,
    /do not match/,
  );
  assert.match(
    validatePayoutMethodInput({
      type: 'bank',
      accountHolderName: 'A Rao',
      accountNumber: '123456789',
      ifsc: 'HDFC1001234',
    }).error,
    /IFSC/,
  );
});

test('validatePayoutMethodInput: upi and bad input', () => {
  assert.deepEqual(
    validatePayoutMethodInput({ type: 'upi', accountHolderName: 'Asha', vpa: 'Asha.Rao@OkHdfc' })
      .value,
    {
      type: 'upi',
      accountHolderName: 'Asha',
      vpa: 'asha.rao@okhdfc',
    },
  );
  assert.match(
    validatePayoutMethodInput({ type: 'upi', accountHolderName: 'Asha', vpa: 'asha' }).error,
    /UPI/,
  );
  assert.match(
    validatePayoutMethodInput({ type: 'upi', accountHolderName: '1', vpa: 'a@b' }).error,
    /holder name/,
  );
  assert.match(
    validatePayoutMethodInput({ type: 'card', accountHolderName: 'Asha' }).error,
    /bank' or 'upi/,
  );
});

test('masking', () => {
  assert.equal(maskAccountNumber('123456789012'), '•••• 9012');
  assert.equal(maskVpa('asharao@okhdfc'), 'as•••••@okhdfc');
  assert.equal(maskVpa('ab@ybl'), 'ab•••@ybl');
});

test('payout state machine', () => {
  assert.ok(canTransition('requested', 'approved'));
  assert.ok(canTransition('requested', 'cancelled'));
  assert.ok(canTransition('processing', 'success'));
  assert.ok(canTransition('success', 'reversed'));
  assert.ok(!canTransition('success', 'failed'));
  assert.ok(!canTransition('failed', 'success'));
  assert.ok(!canTransition('cancelled', 'approved'));
  assert.ok(!canTransition('approved', 'rejected'));
  assert.deepEqual(fromStatusesFor('failed').sort(), ['approved', 'processing']);
  assert.deepEqual(fromStatusesFor('reversed').sort(), ['approved', 'processing', 'success']);
});

test('mapCashfreeTransferStatus', () => {
  assert.equal(mapCashfreeTransferStatus('SUCCESS'), 'success');
  assert.equal(mapCashfreeTransferStatus('REJECTED'), 'failed');
  assert.equal(mapCashfreeTransferStatus('MANUALLY_REJECTED'), 'failed');
  assert.equal(mapCashfreeTransferStatus('FAILED'), 'failed');
  assert.equal(mapCashfreeTransferStatus('REVERSED'), 'reversed');
  assert.equal(mapCashfreeTransferStatus('PENDING'), null);
  assert.equal(mapCashfreeTransferStatus('SOMETHING_NEW'), null);
  assert.equal(mapCashfreeTransferStatus(undefined), null);
});

test('checkWithdrawal', () => {
  const settings = {
    payoutsEnabled: true,
    minWithdrawalMinor: 10_000,
    maxWithdrawalMinor: 1_000_000,
  };
  assert.deepEqual(checkWithdrawal({ amountMinor: 50_000, availableMinor: 60_000, settings }), {
    ok: true,
  });
  assert.equal(
    checkWithdrawal({ amountMinor: 50_000, availableMinor: 40_000, settings }).code,
    'INSUFFICIENT_BALANCE',
  );
  assert.equal(
    checkWithdrawal({ amountMinor: 5_000, availableMinor: 40_000, settings }).code,
    'BELOW_MINIMUM',
  );
  assert.equal(
    checkWithdrawal({ amountMinor: 2_000_000, availableMinor: 9_000_000, settings }).code,
    'ABOVE_MAXIMUM',
  );
  assert.equal(
    checkWithdrawal({ amountMinor: 1.5, availableMinor: 40_000, settings }).code,
    'INVALID_AMOUNT',
  );
  assert.equal(
    checkWithdrawal({ amountMinor: 50_000, availableMinor: 60_000, settings, openPayouts: 1 }).code,
    'PAYOUT_IN_PROGRESS',
  );
  assert.equal(
    checkWithdrawal({
      amountMinor: 50_000,
      availableMinor: 60_000,
      settings: { ...settings, payoutsEnabled: false },
    }).code,
    'PAYOUTS_PAUSED',
  );
  // Negative balance after an admin debit message never shows a negative cap.
  assert.match(
    checkWithdrawal({ amountMinor: 50_000, availableMinor: -100, settings }).message,
    /up to ₹0/,
  );
});

test('summarizeWallet', () => {
  assert.deepEqual(
    summarizeWallet({
      releasedNet: 100_000,
      onHoldNet: 20_000,
      debited: 30_000,
      inFlight: 10_000,
      paidOut: 20_000,
    }),
    {
      availableMinor: 70_000,
      onHoldMinor: 20_000,
      inFlightMinor: 10_000,
      withdrawnMinor: 20_000,
    },
  );
});

test('transferIdFor fits Cashfree limits', () => {
  const id = transferIdFor('65f1c2a9e4b0a1b2c3d4e5f6');
  assert.ok(id.length <= 40);
  assert.match(id, /^[A-Za-z0-9_]+$/);
});

test('verifyPayoutWebhook: HMAC of timestamp + raw body, base64', async () => {
  const crypto = await import('node:crypto');
  const { verifyPayoutWebhook } = await import('../cashfreePayoutClient.js');
  const secret = 'test_secret';
  const rawBody = '{"type":"TRANSFER_SUCCESS","data":{"transfer_id":"nura_po_1"}}';
  const timestamp = '1727800000';
  const signature = crypto
    .createHmac('sha256', secret)
    .update(timestamp + rawBody)
    .digest('base64');
  assert.equal(verifyPayoutWebhook({ rawBody, signature, timestamp, secret }), true);
  assert.equal(
    verifyPayoutWebhook({ rawBody: rawBody + ' ', signature, timestamp, secret }),
    false,
  );
  assert.equal(verifyPayoutWebhook({ rawBody, signature, timestamp: '1727800001', secret }), false);
  assert.equal(verifyPayoutWebhook({ rawBody, signature: 'short', timestamp, secret }), false);
  assert.equal(verifyPayoutWebhook({ rawBody, signature, timestamp, secret: '' }), false);
});
