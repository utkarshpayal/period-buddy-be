/**
 * Pure helpers for doctor commission, wallet and payouts (no DB, no network),
 * unit-tested in __tests__/payoutMath.test.js. The design is in the Admin
 * Workspace repo's docs/doctor-payouts.md.
 *
 * Every amount here is an integer number of the currency's minor unit (paise
 * for INR). Consultation.amountPaid is stored in whole rupees, so it is
 * converted once with toMinor() and never handled as a float again.
 */

/** Rupees (number, up to 2 decimals) → paise (integer). */
export const toMinor = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
};

/** Paise → rupees, for API responses and Cashfree (which wants whole units). */
export const fromMinor = (minor) => Math.round(Number(minor) || 0) / 100;

/**
 * Commission percentages are stored as basis points (1% = 100 bps), so a
 * rate like 12.5% is exact. Valid range 0–100%.
 */
export const percentToBps = (percent) => {
  const n = Number(percent);
  if (!Number.isFinite(n) || n < 0 || n > 100) return null;
  // Two decimal places of a percent is the finest the UI offers.
  return Math.round(n * 100);
};

export const bpsToPercent = (bps) => Math.round(Number(bps) || 0) / 100;

/**
 * Split a gross amount into the platform's commission and the doctor's net.
 * The commission is rounded half-up to the paisa; the doctor gets the rest,
 * so commission + net always equals gross exactly.
 */
export const splitCommission = (grossMinor, commissionBps) => {
  const gross = Math.max(0, Math.round(Number(grossMinor) || 0));
  const bps = Math.min(10_000, Math.max(0, Math.round(Number(commissionBps) || 0)));
  const commission = Math.floor((gross * bps + 5_000) / 10_000);
  return {
    grossMinor: gross,
    commissionBps: bps,
    commissionMinor: commission,
    netMinor: gross - commission,
  };
};

/** The rate that applies to a doctor: their override, else the default. */
export const effectiveCommissionBps = (doctor, settings) => {
  const override = doctor?.commissionBps;
  if (Number.isInteger(override) && override >= 0 && override <= 10_000) {
    return { bps: override, source: 'doctor' };
  }
  return { bps: settings?.defaultCommissionBps ?? 0, source: 'default' };
};

const DAY_MS = 86_400_000;

/** When a completed session's earning becomes withdrawable. */
export const releaseDateFor = (completedAt, holdDays) => {
  const base = completedAt ? new Date(completedAt) : new Date();
  const days = Math.max(0, Math.floor(Number(holdDays) || 0));
  return new Date(base.getTime() + days * DAY_MS);
};

/* --------------------------- Payout methods ---------------------------- */

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_RE = /^\d{9,18}$/;
// handle@psp — Cashfree allows letters, digits, . - _ in the handle.
const VPA_RE = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z][a-zA-Z0-9]{1,63}$/;
// Cashfree: beneficiary_name is alphabets and whitespace only, max 100.
const NAME_RE = /^[A-Za-z][A-Za-z ]{1,99}$/;

export const normalizeIfsc = (v) =>
  String(v ?? '')
    .trim()
    .toUpperCase();
export const normalizeAccountNumber = (v) => String(v ?? '').replace(/[\s-]/g, '');
export const normalizeVpa = (v) =>
  String(v ?? '')
    .trim()
    .toLowerCase();
export const normalizeHolderName = (v) =>
  String(v ?? '')
    .replace(/[^A-Za-z ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Validate a payout method from the clinician portal. Returns
 * `{ value }` (normalized, ready to store) or `{ error }` (a message the
 * doctor can act on).
 */
export const validatePayoutMethodInput = (input = {}) => {
  const type = input.type;
  const holderName = normalizeHolderName(input.accountHolderName);
  if (!NAME_RE.test(holderName)) {
    return {
      error: 'Enter the account holder name as on the bank account (letters and spaces only)',
    };
  }

  if (type === 'bank') {
    const accountNumber = normalizeAccountNumber(input.accountNumber);
    const confirm = normalizeAccountNumber(input.confirmAccountNumber ?? input.accountNumber);
    const ifsc = normalizeIfsc(input.ifsc);
    if (!ACCOUNT_RE.test(accountNumber)) {
      return { error: 'Account number must be 9 to 18 digits' };
    }
    if (accountNumber !== confirm) return { error: 'Account numbers do not match' };
    if (!IFSC_RE.test(ifsc)) return { error: 'Enter a valid 11-character IFSC (e.g. HDFC0001234)' };
    return { value: { type, accountHolderName: holderName, accountNumber, ifsc } };
  }

  if (type === 'upi') {
    const vpa = normalizeVpa(input.vpa);
    if (!VPA_RE.test(vpa)) return { error: 'Enter a valid UPI ID (e.g. name@okbank)' };
    return { value: { type, accountHolderName: holderName, vpa } };
  }

  return { error: "Payout method type must be 'bank' or 'upi'" };
};

/** "•••• 1234" / "na•••@okbank" — what the UI and emails show. */
export const maskAccountNumber = (accountNumber) => {
  const digits = String(accountNumber ?? '');
  return digits.length >= 4 ? `•••• ${digits.slice(-4)}` : '••••';
};

export const maskVpa = (vpa) => {
  const [handle = '', psp = ''] = String(vpa ?? '').split('@');
  const visible = handle.slice(0, 2);
  return `${visible}${'•'.repeat(Math.max(3, handle.length - 2))}@${psp}`;
};

/* ------------------------------ Payouts -------------------------------- */

/** Payout statuses whose amount is still owed to/held from the wallet. */
export const OPEN_PAYOUT_STATUSES = ['requested', 'approved', 'processing'];
/** Statuses that permanently take money out of the wallet. */
export const DEBITING_PAYOUT_STATUSES = [...OPEN_PAYOUT_STATUSES, 'success'];
/** Terminal statuses that give the money back to the wallet. */
export const RETURNED_PAYOUT_STATUSES = ['failed', 'rejected', 'cancelled', 'reversed'];

/**
 * Allowed transitions. `approved` may jump straight to a terminal status,
 * because the dispatch response itself can already say SUCCESS / FAILED.
 * `success → reversed` exists because a bank can bounce a transfer days after
 * Cashfree reported it sent.
 */
const TRANSITIONS = {
  requested: ['approved', 'rejected', 'cancelled'],
  approved: ['processing', 'success', 'failed', 'reversed'],
  processing: ['success', 'failed', 'reversed'],
  success: ['reversed'],
  failed: [],
  rejected: [],
  cancelled: [],
  reversed: [],
};

export const canTransition = (from, to) => (TRANSITIONS[from] || []).includes(to);

/** Statuses a payout may be in for `to` to be reached (for CAS filters). */
export const fromStatusesFor = (to) =>
  Object.keys(TRANSITIONS).filter((from) => TRANSITIONS[from].includes(to));

/**
 * Map a Cashfree Payouts V2 transfer `status` to ours. `null` means "still in
 * flight, keep waiting". Unknown statuses are treated as in flight too, so a
 * new Cashfree status never wrongly frees or settles money; the reconciler
 * logs them.
 */
export const mapCashfreeTransferStatus = (cfStatus) => {
  switch (String(cfStatus || '').toUpperCase()) {
    case 'SUCCESS':
      return 'success';
    case 'FAILED':
    case 'REJECTED':
    case 'MANUALLY_REJECTED':
      return 'failed';
    case 'REVERSED':
      return 'reversed';
    default:
      // RECEIVED, QUEUED, PENDING, APPROVAL_PENDING, VALIDATION_PENDING, …
      return null;
  }
};

/**
 * Check a withdrawal request against the wallet and the admin's limits.
 * Returns `{ ok: true }` or `{ ok: false, code, message }`.
 */
export const checkWithdrawal = ({ amountMinor, availableMinor, settings, openPayouts = 0 }) => {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    return { ok: false, code: 'INVALID_AMOUNT', message: 'Enter an amount to withdraw' };
  }
  if (!settings?.payoutsEnabled) {
    return {
      ok: false,
      code: 'PAYOUTS_PAUSED',
      message: 'Withdrawals are paused right now. Please try again later.',
    };
  }
  if (openPayouts > 0) {
    return {
      ok: false,
      code: 'PAYOUT_IN_PROGRESS',
      message: 'You already have a withdrawal in progress. Wait for it to finish first.',
    };
  }
  const min = settings.minWithdrawalMinor ?? 0;
  const max = settings.maxWithdrawalMinor ?? Number.MAX_SAFE_INTEGER;
  if (amountMinor < min) {
    return {
      ok: false,
      code: 'BELOW_MINIMUM',
      message: `The minimum withdrawal is ₹${fromMinor(min)}`,
    };
  }
  if (amountMinor > max) {
    return {
      ok: false,
      code: 'ABOVE_MAXIMUM',
      message: `The maximum per withdrawal is ₹${fromMinor(max)}`,
    };
  }
  if (amountMinor > availableMinor) {
    return {
      ok: false,
      code: 'INSUFFICIENT_BALANCE',
      message: `You can withdraw up to ₹${fromMinor(Math.max(0, availableMinor))}`,
    };
  }
  return { ok: true };
};

/**
 * Wallet buckets from the two aggregates (see doctorWallet.js#getWalletSummary).
 * `available` can go negative after an admin debit; withdrawals are then
 * blocked until new earnings cover it.
 */
export const summarizeWallet = ({
  releasedNet = 0,
  onHoldNet = 0,
  debited = 0,
  inFlight = 0,
  paidOut = 0,
}) => ({
  availableMinor: releasedNet - debited,
  onHoldMinor: onHoldNet,
  inFlightMinor: inFlight,
  withdrawnMinor: paidOut,
});

/** Cashfree transfer/beneficiary ids: alphanumeric + underscore, ≤ 40 / 50. */
export const transferIdFor = (payoutId) => `nura_po_${payoutId}`;
export const beneficiaryIdFor = (methodId) => `nura_doc_${methodId}`;
