import test from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  hashRecoveryCode,
  looksLikeRecoveryCode,
  matchTotp,
  otpauthUrl,
  totpAt,
} from '../totp.js';

// RFC 6238 test vector: secret "12345678901234567890", SHA1, 8 digits
// 94287082 at t=59 → the 6-digit code is the last six digits, 287082.
const RFC_SECRET = base32Encode(Buffer.from('12345678901234567890'));

test('base32 round-trips', () => {
  assert.equal(base32Decode(RFC_SECRET).toString(), '12345678901234567890');
});

test('matches the RFC 6238 test vectors', () => {
  assert.equal(totpAt(RFC_SECRET, Math.floor(59 / 30)), '287082');
  assert.equal(totpAt(RFC_SECRET, Math.floor(1111111109 / 30)), '081804');
  assert.equal(totpAt(RFC_SECRET, Math.floor(1234567890 / 30)), '005924');
});

test('matchTotp allows one step of drift and never the same step twice', () => {
  const now = 1234567890 * 1000;
  const step = Math.floor(1234567890 / 30);
  assert.equal(matchTotp(RFC_SECRET, '005924', { now }), step);
  assert.equal(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 1), { now }), step - 1);
  assert.equal(matchTotp(RFC_SECRET, totpAt(RFC_SECRET, step - 2), { now }), null);
  assert.equal(matchTotp(RFC_SECRET, '005924', { now, lastStep: step }), null);
  assert.equal(matchTotp(RFC_SECRET, 'abc', { now }), null);
});

test('recovery codes: 8, shown once, stored hashed, forgiving about format', () => {
  const { codes, hashes } = generateRecoveryCodes();
  assert.equal(codes.length, 8);
  assert.match(codes[0], /^[a-z0-9]{5}-[a-z0-9]{5}$/);
  assert.equal(hashRecoveryCode(codes[0].toUpperCase().replace('-', ' ')), hashes[0]);
  assert.ok(looksLikeRecoveryCode(codes[0]));
  assert.ok(!looksLikeRecoveryCode('123456'));
});

test('otpauth link carries the issuer and account', () => {
  const url = otpauthUrl({ secret: 'ABC', account: 'a@thenura.care' });
  assert.match(
    url,
    /^otpauth:\/\/totp\/The%20Nura%3Aa%40thenura\.care\?secret=ABC&issuer=The%20Nura/,
  );
});
