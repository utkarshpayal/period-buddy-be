import crypto from 'crypto';
import logger from './logger.js';

/**
 * Cashfree Payouts V2 (beneficiaries + standard transfers), used to pay
 * doctors' wallet withdrawals. A separate Cashfree product from the Payment
 * Gateway in cashfreeClient.js, with its own credentials:
 *
 *   CASHFREE_PAYOUT_CLIENT_ID / CASHFREE_PAYOUT_CLIENT_SECRET
 *   CASHFREE_PAYOUT_ENV        'production' | 'sandbox' (default: CASHFREE_ENV)
 *   CASHFREE_PAYOUT_PUBLIC_KEY optional PEM (raw or base64). Payouts only
 *                              accepts calls from whitelisted IPs, or with an
 *                              x-cf-signature made from this key. Set it unless
 *                              the server's IP is whitelisted in Cashfree.
 *
 * Errors are split in two, because it decides whether a retry is safe:
 * - PayoutRejectedError: Cashfree answered and said no (4xx). Nothing was sent.
 * - PayoutUnknownError: timeout, network error, 5xx, 429. The transfer may or
 *   may not exist; look it up by transfer_id before trying again.
 */

const ENV =
  (process.env.CASHFREE_PAYOUT_ENV || process.env.CASHFREE_ENV) === 'production'
    ? 'production'
    : 'sandbox';
const API_BASE =
  ENV === 'production' ? 'https://api.cashfree.com/payout' : 'https://sandbox.cashfree.com/payout';
const API_VERSION = '2024-01-01';
const TIMEOUT_MS = 15_000;

export class PayoutRejectedError extends Error {
  constructor(message, { code, status } = {}) {
    super(message);
    this.name = 'PayoutRejectedError';
    this.code = code;
    this.status = status;
  }
}

export class PayoutUnknownError extends Error {
  constructor(message, { status, cause } = {}) {
    super(message, { cause });
    this.name = 'PayoutUnknownError';
    this.status = status;
  }
}

export const isPayoutConfigured = () =>
  Boolean(process.env.CASHFREE_PAYOUT_CLIENT_ID && process.env.CASHFREE_PAYOUT_CLIENT_SECRET);

export const payoutMode = () => ENV;

/** The secret Cashfree signs payout webhooks with. */
export const payoutWebhookSecret = () => process.env.CASHFREE_PAYOUT_CLIENT_SECRET || '';

const publicKey = () => {
  const raw = process.env.CASHFREE_PAYOUT_PUBLIC_KEY;
  if (!raw) return null;
  return raw.includes('BEGIN') ? raw : Buffer.from(raw, 'base64').toString('utf8');
};

/** x-cf-signature: RSA-OAEP of "<clientId>.<unix seconds>" with Cashfree's public key. */
const signature = () => {
  const key = publicKey();
  if (!key) return null;
  const payload = `${process.env.CASHFREE_PAYOUT_CLIENT_ID}.${Math.floor(Date.now() / 1000)}`;
  return crypto
    .publicEncrypt({ key, padding: crypto.constants.RSA_PKCS1_OAEP_PADDING }, Buffer.from(payload))
    .toString('base64');
};

const headers = () => {
  if (!isPayoutConfigured()) {
    throw new PayoutRejectedError('Payouts are not configured on the server', {
      code: 'not_configured',
    });
  }
  const h = {
    'x-client-id': process.env.CASHFREE_PAYOUT_CLIENT_ID,
    'x-client-secret': process.env.CASHFREE_PAYOUT_CLIENT_SECRET,
    'x-api-version': API_VERSION,
    'x-request-id': crypto.randomUUID(),
    'Content-Type': 'application/json',
  };
  const sig = signature();
  if (sig) h['x-cf-signature'] = sig;
  return h;
};

/** One call. Returns `{ status, data }`; throws PayoutUnknownError when the
 * outcome can't be known (no response / 5xx / 429). */
const call = async (method, path, body) => {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof PayoutRejectedError) throw error;
    throw new PayoutUnknownError(`Cashfree Payouts unreachable: ${error.message}`, {
      cause: error,
    });
  }
  const data = await response.json().catch(() => ({}));
  if (response.status >= 500 || response.status === 429) {
    throw new PayoutUnknownError(data?.message || `Cashfree Payouts error ${response.status}`, {
      status: response.status,
    });
  }
  return { status: response.status, data };
};

const rejected = (status, data, fallback) =>
  new PayoutRejectedError(data?.message || fallback, { code: data?.code, status });

/**
 * Register a bank account or UPI ID. Idempotent per beneficiaryId: if it
 * already exists (an earlier attempt timed out after Cashfree saved it), the
 * existing one is returned.
 */
export const createBeneficiary = async ({
  beneficiaryId,
  name,
  accountNumber,
  ifsc,
  vpa,
  email,
  phone,
}) => {
  const instrument = vpa ? { vpa } : { bank_account_number: accountNumber, bank_ifsc: ifsc };
  const contact = {};
  if (email) contact.beneficiary_email = email;
  if (phone && /^\d{10}$/.test(String(phone).replace(/^\+?91/, ''))) {
    contact.beneficiary_phone = String(phone).replace(/^\+?91/, '');
    contact.beneficiary_country_code = '+91';
  }

  const { status, data } = await call('POST', '/beneficiary', {
    beneficiary_id: beneficiaryId,
    beneficiary_name: name,
    beneficiary_instrument_details: instrument,
    beneficiary_contact_details: Object.keys(contact).length ? contact : undefined,
  });
  if (status === 200 || status === 201) return data;
  if (status === 409 && data?.code === 'beneficiary_id_already_exists') {
    const existing = await getBeneficiary(beneficiaryId);
    if (existing) return existing;
  }
  logger.warn('cashfree_beneficiary_rejected', {
    action: 'cashfree_beneficiary_rejected',
    beneficiaryId,
    status,
    code: data?.code,
  });
  throw rejected(status, data, 'Cashfree could not add this payout method');
};

export const getBeneficiary = async (beneficiaryId) => {
  const { status, data } = await call(
    'GET',
    `/beneficiary?beneficiary_id=${encodeURIComponent(beneficiaryId)}`,
  );
  if (status === 200) return data;
  if (status === 404) return null;
  throw rejected(status, data, 'Cashfree beneficiary lookup failed');
};

/** Best-effort: a beneficiary that's already gone counts as removed. */
export const removeBeneficiary = async (beneficiaryId) => {
  const { status, data } = await call(
    'DELETE',
    `/beneficiary?beneficiary_id=${encodeURIComponent(beneficiaryId)}`,
  );
  if (status === 200 || status === 404) return true;
  throw rejected(status, data, 'Cashfree beneficiary removal failed');
};

/**
 * Start a transfer. Never call this twice for one transferId without a
 * getTransfer() in between: Cashfree answers a repeated transfer_id with
 * DUPLICATE_TRANSFER (status REJECTED), which must not be read as "failed".
 */
export const createTransfer = async ({ transferId, amount, mode, beneficiaryId, remarks }) => {
  const { status, data } = await call('POST', '/transfers', {
    transfer_id: transferId,
    transfer_amount: amount,
    transfer_currency: 'INR',
    transfer_mode: mode,
    beneficiary_details: { beneficiary_id: beneficiaryId },
    transfer_remarks: remarks
      ? String(remarks)
          .replace(/[^A-Za-z0-9 ]/g, '')
          .slice(0, 70)
      : undefined,
  });
  if (status === 200 || status === 201 || status === 202) return data;
  throw rejected(status, data, 'Cashfree rejected the transfer');
};

/** Live transfer status, or null if Cashfree has no transfer with this id. */
export const getTransfer = async (transferId) => {
  const { status, data } = await call(
    'GET',
    `/transfers?transfer_id=${encodeURIComponent(transferId)}`,
  );
  if (status === 200) return data;
  if (status === 404) return null;
  throw rejected(status, data, 'Cashfree transfer lookup failed');
};

/**
 * Verify a payouts webhook: base64(HMAC-SHA256(timestamp + rawBody, secret)),
 * compared in constant time. `rawBody` must be the exact bytes received.
 */
export const verifyPayoutWebhook = ({
  rawBody,
  signature: sig,
  timestamp,
  secret = payoutWebhookSecret(),
}) => {
  if (!secret || !sig || !timestamp || rawBody == null) return false;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}${rawBody}`)
    .digest('base64');
  const a = Buffer.from(expected);
  const b = Buffer.from(String(sig));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};
