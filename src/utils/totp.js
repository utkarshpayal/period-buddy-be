import crypto from 'crypto';

/**
 * Time-based one-time codes (RFC 6238, the scheme Google Authenticator,
 * Microsoft Authenticator, 1Password etc. use): HMAC-SHA1, 6 digits, 30 s.
 * Used for staff and doctor two-step sign-in (utils/loginSecurity.js).
 * Dependency-free on purpose.
 */

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const TOTP_STEP_SECONDS = 30;
export const TOTP_DIGITS = 6;

export const base32Encode = (buffer) => {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
};

export const base32Decode = (text) => {
  const clean = String(text)
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const out = [];
  for (const ch of clean) {
    value = (value << 5) | ALPHABET.indexOf(ch);
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
};

/** A new random secret (160 bits), base32 as authenticator apps expect. */
export const generateTotpSecret = () => base32Encode(crypto.randomBytes(20));

/** The time step (30-second window number) for a moment. */
export const stepAt = (ms = Date.now()) => Math.floor(ms / 1000 / TOTP_STEP_SECONDS);

/** The code for one time step. */
export const totpAt = (secret, step) => {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac('sha1', base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = hmac.readUInt32BE(offset) & 0x7fffffff;
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0');
};

/**
 * The time step a code matches, allowing one step of clock drift either
 * way, or null. Never accepts a step at or before `lastStep`, so a code
 * can't be used twice.
 */
export const matchTotp = (secret, code, { now = Date.now(), lastStep = -1 } = {}) => {
  if (!/^\d{6}$/.test(String(code ?? ''))) return null;
  const current = stepAt(now);
  for (const step of [current - 1, current, current + 1]) {
    if (step <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, step));
    if (crypto.timingSafeEqual(expected, Buffer.from(String(code)))) return step;
  }
  return null;
};

/** The otpauth:// link an authenticator app scans (as a QR code). */
export const otpauthUrl = ({ secret, account, issuer = 'The Nura' }) =>
  `otpauth://totp/${encodeURIComponent(`${issuer}:${account}`)}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${TOTP_DIGITS}&period=${TOTP_STEP_SECONDS}`;

/* ------------------------------ Recovery codes ------------------------------ */

export const RECOVERY_CODE_COUNT = 8;
const RECOVERY_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no look-alikes

/** "abcde-fghij": 10 random characters. */
const newRecoveryCode = () => {
  const bytes = crypto.randomBytes(10);
  const chars = [...bytes].map((b) => RECOVERY_ALPHABET[b % RECOVERY_ALPHABET.length]).join('');
  return `${chars.slice(0, 5)}-${chars.slice(5)}`;
};

export const normalizeRecoveryCode = (code) =>
  String(code ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');

export const hashRecoveryCode = (code) =>
  crypto.createHash('sha256').update(normalizeRecoveryCode(code)).digest('hex');

/** Fresh codes: `{ codes }` to show once, `hashes` to store. */
export const generateRecoveryCodes = () => {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, newRecoveryCode);
  return { codes, hashes: codes.map(hashRecoveryCode) };
};

export const looksLikeRecoveryCode = (code) => normalizeRecoveryCode(code).length === 10;
