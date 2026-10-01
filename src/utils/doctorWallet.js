import mongoose from 'mongoose';
import ClinicalPayoutSettings from '../models/ClinicalPayoutSettings.js';
import Consultation from '../models/Consultation.js';
import Doctor from '../models/Doctor.js';
import DoctorEarning from '../models/DoctorEarning.js';
import DoctorPayout from '../models/DoctorPayout.js';
import DoctorPayoutMethod from '../models/DoctorPayoutMethod.js';
import DoctorWallet from '../models/DoctorWallet.js';
import User from '../models/User.js';
import logger from './logger.js';
import { sendMail } from './mailer.js';
import { getDoctorPayoutTemplate } from '../templates/emailTemplates.js';
import {
  DEBITING_PAYOUT_STATUSES,
  OPEN_PAYOUT_STATUSES,
  beneficiaryIdFor,
  checkWithdrawal,
  effectiveCommissionBps,
  fromMinor,
  fromStatusesFor,
  mapCashfreeTransferStatus,
  maskAccountNumber,
  maskVpa,
  releaseDateFor,
  splitCommission,
  summarizeWallet,
  toMinor,
  transferIdFor,
} from './payoutMath.js';
import {
  PayoutRejectedError,
  PayoutUnknownError,
  createBeneficiary,
  createTransfer,
  getTransfer,
  isPayoutConfigured,
  removeBeneficiary,
} from './cashfreePayoutClient.js';

/**
 * Doctor commission, wallet and payouts. Design: the Admin Workspace repo's
 * docs/doctor-payouts.md. In short:
 *
 * - Balances are never stored. They are summed from DoctorEarning (money in)
 *   and DoctorPayout (money out) on every read, so there's nothing to drift.
 * - Anything that can lower a balance (a withdrawal, an admin debit or
 *   reversal) runs in a transaction that bumps the doctor's DoctorWallet
 *   `seq`, so two of them for one doctor can't both pass the balance check.
 * - Consultation hooks (paid / completed / cancelled) are best-effort and
 *   never fail the request; reconcileEarnings() (utils/payoutRunner.js)
 *   repairs anything a hook missed.
 * - Payout status only moves by compare-and-set along payoutMath's
 *   TRANSITIONS, so webhooks, the reconciler and admins can race safely.
 */

export class WalletError extends Error {
  constructor(message, status = 400, code = 'WALLET_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/** Only INR can be paid out via Cashfree; other currencies are shown, not withdrawable. */
const WALLET_CURRENCY = 'INR';
const CHECK_PROCESSING_MS = 10 * 60_000;
const DISPATCH_RETRY_BASE_MS = 2 * 60_000;
const DISPATCH_RETRY_MAX_MS = 30 * 60_000;
/** A dispatch claim older than this is assumed dead (crash mid-call). */
const DISPATCH_LEASE_MS = 2 * 60_000;

/* ------------------------------- Settings ------------------------------ */

export const getPayoutSettings = async () => {
  const settings = await ClinicalPayoutSettings.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  ).lean();
  return settings;
};

/** Which way new withdrawals are paid: Cashfree only when chosen AND set up. */
export const payoutProviderFor = (settings) =>
  settings?.payoutProvider === 'cashfree' && isPayoutConfigured() ? 'cashfree' : 'manual';

export const describeSettings = (s) => ({
  payoutProvider: s.payoutProvider || 'manual',
  activeProvider: payoutProviderFor(s),
  autoReleaseDays: s.autoReleaseDays ?? 7,
  defaultCommissionPercent: s.defaultCommissionBps / 100,
  holdDays: s.holdDays,
  payoutsEnabled: s.payoutsEnabled,
  requireApproval: s.requireApproval,
  minWithdrawal: fromMinor(s.minWithdrawalMinor),
  maxWithdrawal: fromMinor(s.maxWithdrawalMinor),
  newMethodCooldownHours: s.newMethodCooldownHours,
  earningsStartAt: s.earningsStartAt,
  payoutsConfigured: isPayoutConfigured(),
  updatedAt: s.updatedAt,
});

/* ------------------------------ Earnings ------------------------------- */

const isDuplicateKey = (error) => error?.code === 11000;

/**
 * Create the earning for a paid consultation (idempotent: one per
 * consultation). The commission is the doctor's rate at this moment. If the
 * consultation is already completed (the reconciler catching up), the hold
 * starts from its completion.
 */
export const recordConsultationEarning = async (consultationOrId, { settings } = {}) => {
  const consultation =
    consultationOrId instanceof mongoose.Model || consultationOrId?.doctorId
      ? consultationOrId
      : await Consultation.findById(consultationOrId).lean();
  if (!consultation || consultation.paymentStatus !== 'paid') return null;
  if (consultation.status === 'cancelled') return null;

  const cfg = settings || (await getPayoutSettings());
  const doctorId = consultation.doctorId?._id || consultation.doctorId;
  const doctor = await Doctor.findById(doctorId).select('+commissionBps').lean();
  if (!doctor) return null;

  const { bps, source } = effectiveCommissionBps(doctor, cfg);
  const split = splitCommission(toMinor(consultation.amountPaid), bps);
  const completed = consultation.status === 'completed';
  const completedAt = completed ? consultation.completedAt || new Date() : undefined;

  try {
    await DoctorEarning.updateOne(
      { type: 'consultation', consultationId: consultation._id },
      {
        $setOnInsert: {
          doctorId,
          type: 'consultation',
          consultationId: consultation._id,
          currency: (consultation.currency || WALLET_CURRENCY).toUpperCase(),
          ...split,
          commissionSource: source,
          status: 'active',
          paidAt: consultation.startedAt || consultation.updatedAt || new Date(),
          completedAt,
          availableAt: completed ? releaseDateFor(completedAt, cfg.holdDays) : null,
        },
      },
      { upsert: true },
    );
  } catch (error) {
    if (!isDuplicateKey(error)) throw error; // a concurrent insert won; fine
  }
  return DoctorEarning.findOne({ type: 'consultation', consultationId: consultation._id }).lean();
};

/** Session completed: start the hold, after which the earning is withdrawable. */
export const releaseConsultationEarning = async (consultationId, completedAt = new Date()) => {
  const settings = await getPayoutSettings();
  const updated = await DoctorEarning.findOneAndUpdate(
    { type: 'consultation', consultationId, status: 'active', availableAt: null },
    { $set: { completedAt, availableAt: releaseDateFor(completedAt, settings.holdDays) } },
    { new: true },
  );
  if (updated) return updated;
  // No earning yet (its hook failed): create it, already released.
  const existing = await DoctorEarning.exists({ type: 'consultation', consultationId });
  if (!existing) return recordConsultationEarning(consultationId, { settings });
  return null;
};

/**
 * Consultations cancelled before completion: their earnings are no longer
 * owed. Only a session that was never completed can be cancelled, so this
 * reaches earnings on hold, or released by auto-release; if the doctor
 * already withdrew one of those, the balance goes negative and future
 * earnings cover it.
 */
export const reverseConsultationEarnings = async (consultationIds, reason) => {
  const ids = (Array.isArray(consultationIds) ? consultationIds : [consultationIds]).filter(
    Boolean,
  );
  if (ids.length === 0) return 0;
  const result = await DoctorEarning.updateMany(
    { type: 'consultation', consultationId: { $in: ids }, status: 'active', completedAt: null },
    { $set: { status: 'reversed', reversedAt: new Date(), reversalReason: reason } },
  );
  return result.modifiedCount || 0;
};

/**
 * Run a consultation hook without ever failing the caller. A miss is logged
 * and fixed by the reconciler.
 */
export const safeEarningHook = async (name, fn) => {
  try {
    return await fn();
  } catch (error) {
    logger.error('doctor_earning_hook_failed', {
      action: 'doctor_earning_hook_failed',
      hook: name,
      error: error.message,
    });
    return null;
  }
};

/* ------------------------------- Wallet -------------------------------- */

const lockWallet = (doctorId, session) =>
  DoctorWallet.findOneAndUpdate(
    { doctorId },
    { $inc: { seq: 1 } },
    { upsert: true, new: true, session },
  );

/**
 * The doctor's balances, in paise. `session` makes it part of a transaction
 * (snapshot reads, so it matches the lock).
 */
export const computeWallet = async (doctorId, { session, now = new Date() } = {}) => {
  const id = new mongoose.Types.ObjectId(String(doctorId));
  const [earnings, payouts] = await Promise.all([
    DoctorEarning.aggregate([
      { $match: { doctorId: id, status: 'active', currency: WALLET_CURRENCY } },
      {
        $group: {
          _id: null,
          releasedNet: {
            $sum: {
              $cond: [
                { $and: [{ $ne: ['$availableAt', null] }, { $lte: ['$availableAt', now] }] },
                '$netMinor',
                0,
              ],
            },
          },
          onHoldNet: {
            $sum: {
              $cond: [
                { $or: [{ $eq: ['$availableAt', null] }, { $gt: ['$availableAt', now] }] },
                '$netMinor',
                0,
              ],
            },
          },
          gross: { $sum: { $cond: [{ $eq: ['$type', 'consultation'] }, '$grossMinor', 0] } },
          commission: { $sum: '$commissionMinor' },
          nextReleaseAt: {
            $min: { $cond: [{ $gt: ['$availableAt', now] }, '$availableAt', null] },
          },
        },
      },
    ]).session(session || null),
    DoctorPayout.aggregate([
      { $match: { doctorId: id, currency: WALLET_CURRENCY } },
      { $group: { _id: '$status', total: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
    ]).session(session || null),
  ]);

  const e = earnings[0] || {};
  const byStatus = Object.fromEntries(payouts.map((p) => [p._id, p]));
  const sum = (statuses) => statuses.reduce((acc, s) => acc + (byStatus[s]?.total || 0), 0);
  const openCount = OPEN_PAYOUT_STATUSES.reduce((acc, s) => acc + (byStatus[s]?.count || 0), 0);

  return {
    ...summarizeWallet({
      releasedNet: e.releasedNet || 0,
      onHoldNet: e.onHoldNet || 0,
      debited: sum(DEBITING_PAYOUT_STATUSES),
      inFlight: sum(OPEN_PAYOUT_STATUSES),
      paidOut: sum(['success']),
    }),
    lifetimeGrossMinor: e.gross || 0,
    lifetimeCommissionMinor: e.commission || 0,
    nextReleaseAt: e.nextReleaseAt || null,
    openPayouts: openCount,
  };
};

/** API shape (rupees). */
export const describeWallet = (w) => ({
  currency: WALLET_CURRENCY,
  available: fromMinor(w.availableMinor),
  withdrawable: fromMinor(Math.max(0, w.availableMinor)),
  onHold: fromMinor(w.onHoldMinor),
  inFlight: fromMinor(w.inFlightMinor),
  withdrawn: fromMinor(w.withdrawnMinor),
  lifetimeGross: fromMinor(w.lifetimeGrossMinor),
  lifetimeCommission: fromMinor(w.lifetimeCommissionMinor),
  lifetimeNet: fromMinor(w.lifetimeGrossMinor - w.lifetimeCommissionMinor),
  nextReleaseAt: w.nextReleaseAt,
  openPayouts: w.openPayouts,
});

/** Run `fn(session)` in a transaction. Atlas is a replica set, so this is
 * available in every environment we run; a standalone mongod fails loudly. */
const inTransaction = async (fn) => {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

/* ---------------------------- Payout methods --------------------------- */

const MAX_ACTIVE_METHODS = 3;

export const listPayoutMethods = (doctorId) =>
  DoctorPayoutMethod.find({ doctorId, status: 'active' }).sort({ isDefault: -1, createdAt: -1 });

const notifyDoctor = async (doctor, template) => {
  try {
    const to = doctor.email || (await User.findById(doctor.userId).select('email').lean())?.email;
    if (!to) return;
    await sendMail({
      to,
      subject: template.heading,
      html: getDoctorPayoutTemplate({ name: doctor.name, ...template }),
    });
  } catch (error) {
    logger.error('doctor_payout_email_failed', {
      action: 'doctor_payout_email_failed',
      error: error.message,
    });
  }
};

/** Register a method with Cashfree (idempotent). Throws a WalletError a
 * doctor can act on when Cashfree refuses the account. */
const registerBeneficiary = async (method, doctor) => {
  try {
    const user = doctor?.userId
      ? await User.findById(doctor.userId).select('email phone').lean()
      : null;
    await createBeneficiary({
      beneficiaryId: method.cashfreeBeneficiaryId,
      name: method.accountHolderName,
      accountNumber: method.accountNumber,
      ifsc: method.ifsc,
      vpa: method.vpa,
      email: user?.email || doctor?.email,
      phone: user?.phone,
    });
  } catch (error) {
    if (error instanceof PayoutRejectedError) {
      const message =
        error.code === 'beneficiary_already_exists'
          ? 'This account is already registered for payouts. Contact the Nura team if it is yours.'
          : `Cashfree could not add this payout method: ${error.message}`;
      throw new WalletError(message, 422, 'BENEFICIARY_REJECTED');
    }
    throw new WalletError(
      'Could not reach the payout provider. Please try again shortly.',
      503,
      'PROVIDER_UNAVAILABLE',
    );
  }
  await DoctorPayoutMethod.updateOne(
    { _id: method._id },
    { $set: { beneficiaryRegisteredAt: new Date() } },
  );
};

/**
 * Add a bank account or UPI ID (already validated by
 * payoutMath#validatePayoutMethodInput). With Cashfree active it's
 * registered there straight away (and deleted again if Cashfree refuses);
 * in manual mode it's only stored, and registered on its first Cashfree
 * payout if you switch later.
 */
export const addPayoutMethod = async (doctor, value) => {
  const active = await DoctorPayoutMethod.find({ doctorId: doctor._id, status: 'active' }).select(
    'type ifsc vpa last4 accountNumber',
  );
  if (active.length >= MAX_ACTIVE_METHODS) {
    throw new WalletError(
      `You can keep up to ${MAX_ACTIVE_METHODS} payout methods. Remove one first.`,
      409,
      'TOO_MANY_METHODS',
    );
  }
  const duplicate = active.some((m) =>
    value.type === 'upi'
      ? m.type === 'upi' && m.vpa === value.vpa
      : m.type === 'bank' && m.ifsc === value.ifsc && m.accountNumber === value.accountNumber,
  );
  if (duplicate)
    throw new WalletError('This payout method is already added', 409, 'DUPLICATE_METHOD');

  const settings = await getPayoutSettings();
  const _id = new mongoose.Types.ObjectId();
  // Even a first method waits: the security email gives the real doctor time
  // to react if someone else signed in and added it.
  const cooldownMs = settings.newMethodCooldownHours * 3_600_000;

  const method = await DoctorPayoutMethod.create({
    _id,
    doctorId: doctor._id,
    type: value.type,
    accountHolderName: value.accountHolderName,
    accountNumber: value.accountNumber,
    ifsc: value.ifsc,
    vpa: value.vpa,
    last4: value.accountNumber ? value.accountNumber.slice(-4) : undefined,
    display:
      value.type === 'bank'
        ? `${value.ifsc.slice(0, 4)} ${maskAccountNumber(value.accountNumber)}`
        : maskVpa(value.vpa),
    cashfreeBeneficiaryId: beneficiaryIdFor(_id),
    isDefault: active.length === 0,
    usableFrom: new Date(Date.now() + cooldownMs),
  });

  if (payoutProviderFor(settings) === 'cashfree') {
    try {
      await registerBeneficiary(method, doctor);
    } catch (error) {
      await DoctorPayoutMethod.deleteOne({ _id });
      throw error;
    }
  }

  await notifyDoctor(doctor, {
    badge: 'Security notice',
    tone: 'danger',
    heading: 'A payout method was added to your Nura account',
    body: 'A new bank account or UPI ID was added for your earnings withdrawals.',
    lines: [
      ['Method', method.display],
      ['Name', method.accountHolderName],
      ...(cooldownMs ? [['Usable from', method.usableFrom.toUTCString()]] : []),
    ],
    footer: "If this wasn't you, contact the Nura team immediately and change your password.",
  });
  return method;
};

export const removePayoutMethod = async (doctor, methodId) => {
  const method = await DoctorPayoutMethod.findOne({
    _id: methodId,
    doctorId: doctor._id,
    status: 'active',
  });
  if (!method) throw new WalletError('Payout method not found', 404, 'NOT_FOUND');
  const busy = await DoctorPayout.exists({
    methodId: method._id,
    status: { $in: OPEN_PAYOUT_STATUSES },
  });
  if (busy) {
    throw new WalletError(
      'A withdrawal to this method is in progress. Remove it once that finishes.',
      409,
      'METHOD_IN_USE',
    );
  }
  method.status = 'removed';
  method.removedAt = new Date();
  method.isDefault = false;
  await method.save();

  // Promote another method to default so the withdraw form stays prefilled.
  if (
    !(await DoctorPayoutMethod.exists({ doctorId: doctor._id, status: 'active', isDefault: true }))
  ) {
    await DoctorPayoutMethod.findOneAndUpdate(
      { doctorId: doctor._id, status: 'active' },
      { $set: { isDefault: true } },
      { sort: { createdAt: 1 } },
    );
  }
  try {
    if (method.beneficiaryRegisteredAt) await removeBeneficiary(method.cashfreeBeneficiaryId);
  } catch (error) {
    // Ours is already 'removed', so nothing can pay to it; Cashfree's copy is just clutter.
    logger.warn('cashfree_beneficiary_remove_failed', {
      action: 'cashfree_beneficiary_remove_failed',
      methodId: String(method._id),
      error: error.message,
    });
  }
  await notifyDoctor(doctor, {
    badge: 'Security notice',
    heading: 'A payout method was removed from your Nura account',
    body: 'A bank account or UPI ID was removed from your earnings withdrawals.',
    lines: [['Method', method.display]],
    footer: "If this wasn't you, contact the Nura team and change your password.",
  });
  return method;
};

export const setDefaultPayoutMethod = async (doctor, methodId) => {
  const method = await DoctorPayoutMethod.findOne({
    _id: methodId,
    doctorId: doctor._id,
    status: 'active',
  });
  if (!method) throw new WalletError('Payout method not found', 404, 'NOT_FOUND');
  await DoctorPayoutMethod.updateMany(
    { doctorId: doctor._id, _id: { $ne: method._id } },
    { $set: { isDefault: false } },
  );
  method.isDefault = true;
  await method.save();
  return method;
};

/* ------------------------------- Payouts ------------------------------- */

const event = (status, by, note) => ({ at: new Date(), status, by, note });

/**
 * Move a payout to `to` only if it's still in a status that allows it.
 * Returns the updated doc, or null when someone else moved it first.
 */
const transition = (payoutId, to, { by, note, set = {}, from, where = {} } = {}) =>
  DoctorPayout.findOneAndUpdate(
    { ...where, _id: payoutId, status: { $in: from || fromStatusesFor(to) } },
    { $set: { status: to, ...set }, $push: { events: event(to, by, note) } },
    { new: true },
  );

/**
 * A doctor asks to withdraw `amountMinor` to one of their methods. The
 * balance check and the insert share one transaction with the wallet lock.
 * Retrying with the same idempotency key returns the first payout.
 */
export const requestPayout = async ({ doctor, userId, amountMinor, methodId, idempotencyKey }) => {
  if (!idempotencyKey || !/^[A-Za-z0-9_-]{8,64}$/.test(idempotencyKey)) {
    throw new WalletError('Missing or invalid Idempotency-Key', 400, 'IDEMPOTENCY_KEY');
  }
  const replay = await DoctorPayout.findOne({ doctorId: doctor._id, idempotencyKey });
  if (replay) return { payout: replay, replayed: true };

  const method = await DoctorPayoutMethod.findOne({
    _id: methodId,
    doctorId: doctor._id,
    status: 'active',
  });
  if (!method) throw new WalletError('Choose a payout method', 400, 'NO_METHOD');
  if (method.usableFrom && method.usableFrom > new Date()) {
    throw new WalletError(
      `For your security, this new payout method can be used from ${method.usableFrom.toUTCString()}`,
      409,
      'METHOD_COOLDOWN',
    );
  }

  const settings = await getPayoutSettings();
  const provider = payoutProviderFor(settings);
  let payout;
  try {
    payout = await inTransaction(async (session) => {
      await lockWallet(doctor._id, session);
      const wallet = await computeWallet(doctor._id, { session });
      const check = checkWithdrawal({
        amountMinor,
        availableMinor: wallet.availableMinor,
        settings,
        openPayouts: wallet.openPayouts,
      });
      if (!check.ok) throw new WalletError(check.message, 409, check.code);

      const _id = new mongoose.Types.ObjectId();
      const [created] = await DoctorPayout.create(
        [
          {
            _id,
            doctorId: doctor._id,
            amountMinor,
            currency: WALLET_CURRENCY,
            status: 'requested',
            provider,
            methodId: method._id,
            method: {
              type: method.type,
              display: method.display,
              accountHolderName: method.accountHolderName,
              cashfreeBeneficiaryId: method.cashfreeBeneficiaryId,
            },
            transferId: transferIdFor(_id),
            idempotencyKey,
            requestedBy: userId,
            events: [event('requested', 'doctor')],
          },
        ],
        { session },
      );
      return created;
    });
  } catch (error) {
    // The same key raced in from a double-click: return the winner.
    if (isDuplicateKey(error)) {
      const winner = await DoctorPayout.findOne({ doctorId: doctor._id, idempotencyKey });
      if (winner) return { payout: winner, replayed: true };
    }
    throw error;
  }

  logger.info('doctor_payout_requested', {
    action: 'doctor_payout_requested',
    doctorId: String(doctor._id),
    payoutId: String(payout._id),
    amount: fromMinor(amountMinor),
    provider,
  });

  // Manual payouts always wait for a Clinical Admin to pay and mark them.
  if (provider === 'cashfree' && !settings.requireApproval) {
    const approved = await transition(payout._id, 'approved', {
      by: 'system',
      note: 'Auto-approved',
      set: { approvedAt: new Date() },
    });
    if (approved) return { payout: await dispatchPayout(approved._id) };
  }
  return { payout };
};

export const cancelPayout = async (doctor, payoutId) => {
  const payout = await transition(payoutId, 'cancelled', {
    by: 'doctor',
    from: ['requested'],
    where: { doctorId: doctor._id },
    set: { completedAt: new Date() },
  });
  if (payout) return payout;
  const exists = await DoctorPayout.exists({ _id: payoutId, doctorId: doctor._id });
  throw exists
    ? new WalletError(
        'This withdrawal is already being processed and can no longer be cancelled',
        409,
        'NOT_CANCELLABLE',
      )
    : new WalletError('Withdrawal not found', 404, 'NOT_FOUND');
};

export const approvePayout = async (payoutId, adminId) => {
  const payout = await transition(payoutId, 'approved', {
    by: 'admin',
    where: { provider: { $ne: 'manual' } },
    set: { approvedBy: adminId, approvedAt: new Date() },
  });
  if (!payout && (await DoctorPayout.exists({ _id: payoutId, provider: 'manual' }))) {
    throw new WalletError(
      'This is a manual withdrawal: transfer the money, then use “Mark as paid”.',
      409,
      'MANUAL_PAYOUT',
    );
  }
  if (!payout)
    throw new WalletError('Only a requested withdrawal can be approved', 409, 'NOT_APPROVABLE');
  return dispatchPayout(payout._id);
};

/**
 * Manual payouts: the admin has transferred the money from the bank and
 * records the bank reference (UTR). requested → approved → success, both by
 * compare-and-set, so a double click records it once.
 */
export const markPayoutPaid = async (payoutId, adminId, reference, note) => {
  const now = new Date();
  const approved = await transition(payoutId, 'approved', {
    by: 'admin',
    where: { provider: 'manual' },
    set: { approvedBy: adminId, approvedAt: now },
  });
  if (!approved) {
    const existing = await DoctorPayout.findById(payoutId).select('provider status').lean();
    if (!existing) throw new WalletError('Withdrawal not found', 404, 'NOT_FOUND');
    if (existing.provider !== 'manual') {
      throw new WalletError(
        'This withdrawal goes through Cashfree; approve it instead',
        409,
        'NOT_MANUAL',
      );
    }
    if (existing.status !== 'approved') {
      throw new WalletError(
        'Only a requested withdrawal can be marked as paid',
        409,
        'NOT_PAYABLE',
      );
    }
  }
  const paid = await transition(payoutId, 'success', {
    by: 'admin',
    from: ['approved'],
    where: { provider: 'manual' },
    note: note || `Paid manually, ref ${reference}`,
    set: { utr: reference, paidManuallyBy: adminId, completedAt: now, nextCheckAt: null },
  });
  if (!paid)
    throw new WalletError('Only a requested withdrawal can be marked as paid', 409, 'NOT_PAYABLE');
  logger.info('doctor_payout_marked_paid', {
    action: 'doctor_payout_marked_paid',
    payoutId: String(paid._id),
    amount: fromMinor(paid.amountMinor),
  });
  await outcomeEmail(paid);
  return paid;
};

/** Full bank / UPI details of a payout's method, for paying it by hand. */
export const getPayoutMethodDetails = async (payoutId) => {
  const payout = await DoctorPayout.findById(payoutId).select('methodId doctorId').lean();
  if (!payout) throw new WalletError('Withdrawal not found', 404, 'NOT_FOUND');
  const method = await DoctorPayoutMethod.findById(payout.methodId).lean();
  if (!method) throw new WalletError('Payout method not found', 404, 'NOT_FOUND');
  return {
    type: method.type,
    accountHolderName: method.accountHolderName,
    accountNumber: method.accountNumber,
    ifsc: method.ifsc,
    vpa: method.vpa,
    status: method.status,
  };
};

export const rejectPayout = async (payoutId, adminId, note) => {
  const payout = await transition(payoutId, 'rejected', {
    by: 'admin',
    note,
    set: { rejectedBy: adminId, reviewNote: note, completedAt: new Date() },
  });
  if (!payout)
    throw new WalletError('Only a requested withdrawal can be rejected', 409, 'NOT_REJECTABLE');
  const doctor = await Doctor.findById(payout.doctorId).lean();
  if (doctor) {
    await notifyDoctor(doctor, {
      badge: 'Withdrawal declined',
      tone: 'danger',
      heading: 'Your Nura withdrawal was declined',
      body: 'Your withdrawal request was declined. The amount is back in your wallet.',
      lines: [['Amount', `₹${fromMinor(payout.amountMinor)}`], ...(note ? [['Reason', note]] : [])],
    });
  }
  return payout;
};

const outcomeEmail = async (payout) => {
  const doctor = await Doctor.findById(payout.doctorId).lean();
  if (!doctor) return;
  const amount = `₹${fromMinor(payout.amountMinor)}`;
  if (payout.status === 'success') {
    await notifyDoctor(doctor, {
      badge: 'Withdrawal sent',
      heading: 'Your Nura withdrawal has been sent',
      body: 'Your withdrawal has been sent to your account.',
      lines: [
        ['Amount', amount],
        ['To', payout.method?.display || ''],
        ...(payout.utr ? [['Reference (UTR)', payout.utr]] : []),
      ],
      footer: 'Bank transfers usually arrive within minutes, sometimes up to a working day.',
    });
  } else if (['failed', 'reversed'].includes(payout.status)) {
    await notifyDoctor(doctor, {
      badge: payout.status === 'reversed' ? 'Withdrawal returned' : 'Withdrawal failed',
      tone: 'danger',
      heading: 'Your Nura withdrawal did not go through',
      body: 'Your withdrawal could not be completed. The amount is back in your wallet and you can try again.',
      lines: [
        ['Amount', amount],
        ['To', payout.method?.display || ''],
        ...(payout.failureReason ? [['Reason', payout.failureReason]] : []),
      ],
      footer:
        'If this keeps happening, check the account details or add a different payout method.',
    });
  }
};

const FRIENDLY_FAILURES = {
  INSUFFICIENT_BALANCE: 'A temporary issue on our side. Please try again later.',
  BENEFICIARY_BLACKLISTED: 'The bank rejected this account. Add a different payout method.',
  INVALID_IFSC_FAIL: 'The IFSC is not valid. Add the account again with the correct IFSC.',
  INVALID_ACCOUNT_FAIL: 'The account number is not valid. Add the account again.',
  ACCOUNT_BLOCKED: 'The bank account is blocked or frozen. Add a different payout method.',
};

/**
 * Apply Cashfree's view of a transfer (dispatch response, status lookup or
 * webhook-triggered lookup) to the payout. Idempotent.
 */
export const applyTransferStatus = async (payoutId, cf, by = 'cashfree') => {
  if (!cf) return DoctorPayout.findById(payoutId);
  const mapped = mapCashfreeTransferStatus(cf.status);
  const meta = {
    cfStatus: cf.status,
    cfStatusCode: cf.status_code,
    ...(cf.cf_transfer_id ? { cfTransferId: String(cf.cf_transfer_id) } : {}),
    ...(cf.transfer_utr ? { utr: cf.transfer_utr } : {}),
  };

  if (!mapped) {
    if (
      !['RECEIVED', 'QUEUED', 'PENDING', 'APPROVAL_PENDING', 'VALIDATION_PENDING'].includes(
        String(cf.status),
      )
    ) {
      logger.warn('cashfree_transfer_unknown_status', {
        action: 'cashfree_transfer_unknown_status',
        payoutId: String(payoutId),
        status: cf.status,
      });
    }
    const moved = await transition(payoutId, 'processing', {
      by,
      from: ['approved'],
      set: { ...meta, nextCheckAt: new Date(Date.now() + CHECK_PROCESSING_MS) },
    });
    if (moved) return moved;
    return DoctorPayout.findOneAndUpdate(
      { _id: payoutId, status: 'processing' },
      { $set: { ...meta, nextCheckAt: new Date(Date.now() + CHECK_PROCESSING_MS) } },
      { new: true },
    );
  }

  const failureReason =
    mapped === 'success'
      ? undefined
      : FRIENDLY_FAILURES[cf.status_code] ||
        cf.status_description ||
        `Transfer ${String(cf.status).toLowerCase()}`;
  const moved = await transition(payoutId, mapped, {
    by,
    note: failureReason,
    set: {
      ...meta,
      completedAt: new Date(),
      nextCheckAt: null,
      ...(failureReason ? { failureReason } : {}),
    },
  });
  if (!moved) {
    // Already in that state (a repeated webhook), or a stale message: just refresh the reference.
    return DoctorPayout.findOneAndUpdate(
      { _id: payoutId, status: mapped },
      { $set: meta },
      { new: true },
    );
  }

  logger[mapped === 'success' ? 'info' : 'warn'](`doctor_payout_${mapped}`, {
    action: `doctor_payout_${mapped}`,
    payoutId: String(payoutId),
    statusCode: cf.status_code,
  });
  if (cf.status_code === 'INSUFFICIENT_BALANCE') {
    logger.error('cashfree_payout_low_balance', {
      action: 'cashfree_payout_low_balance',
      payoutId: String(payoutId),
      message:
        'Top up the Cashfree Payouts account; this withdrawal failed and was returned to the wallet',
    });
  }
  await outcomeEmail(moved);
  return moved;
};

const retryDelay = (attempts) =>
  Math.min(DISPATCH_RETRY_MAX_MS, DISPATCH_RETRY_BASE_MS * 2 ** Math.max(0, attempts - 1));

/**
 * Send an approved payout to Cashfree. Safe to call any number of times, from
 * anywhere: a lease stops two dispatchers at once, and every attempt after
 * the first looks the transfer up before creating it, because a timed-out
 * first attempt may have gone through.
 */
export const dispatchPayout = async (payoutId) => {
  const now = new Date();
  const claimed = await DoctorPayout.findOneAndUpdate(
    {
      _id: payoutId,
      status: 'approved',
      provider: { $ne: 'manual' },
      $or: [
        { lastDispatchAt: null },
        { lastDispatchAt: { $lt: new Date(now - DISPATCH_LEASE_MS) } },
      ],
    },
    { $set: { lastDispatchAt: now }, $inc: { dispatchAttempts: 1 } },
    { new: true },
  );
  if (!claimed) return DoctorPayout.findById(payoutId);

  try {
    if (claimed.dispatchAttempts > 1) {
      const existing = await getTransfer(claimed.transferId);
      if (existing) return applyTransferStatus(claimed._id, existing);
    }

    const method = await DoctorPayoutMethod.findById(claimed.methodId).lean();
    if (!method || method.status !== 'active') {
      const failed = await transition(claimed._id, 'failed', {
        by: 'system',
        note: 'Payout method was removed',
        set: {
          failureReason: 'The payout method was removed before the transfer was sent',
          completedAt: new Date(),
        },
      });
      if (failed) await outcomeEmail(failed);
      return failed;
    }
    // Added while payouts were manual: Cashfree hasn't seen it yet.
    if (!method.beneficiaryRegisteredAt) {
      const doctor = await Doctor.findById(claimed.doctorId).lean();
      try {
        await registerBeneficiary(method, doctor);
      } catch (error) {
        if (error.code === 'BENEFICIARY_REJECTED') {
          throw new PayoutRejectedError(error.message, { code: 'beneficiary_rejected' });
        }
        throw new PayoutUnknownError(error.message);
      }
    }

    const response = await createTransfer({
      transferId: claimed.transferId,
      amount: fromMinor(claimed.amountMinor),
      mode: method.type === 'upi' ? 'upi' : 'banktransfer',
      beneficiaryId: method.cashfreeBeneficiaryId,
      remarks: 'Nura consultation earnings',
    });
    if (response?.status_code === 'DUPLICATE_TRANSFER') {
      // Ours already exists; its real status is what counts.
      return applyTransferStatus(claimed._id, await getTransfer(claimed.transferId));
    }
    return applyTransferStatus(claimed._id, response);
  } catch (error) {
    if (error instanceof PayoutRejectedError && error.code !== 'not_configured') {
      const p = await transition(claimed._id, 'failed', {
        by: 'cashfree',
        note: error.message,
        set: { failureReason: error.message, cfStatusCode: error.code, completedAt: new Date() },
      });
      if (p) await outcomeEmail(p);
      return p;
    }
    // Unknown outcome (or not configured): stay approved; the runner retries,
    // looking the transfer up first.
    logger.warn('doctor_payout_dispatch_deferred', {
      action: 'doctor_payout_dispatch_deferred',
      payoutId: String(claimed._id),
      attempts: claimed.dispatchAttempts,
      error: error.message,
    });
    return DoctorPayout.findByIdAndUpdate(
      claimed._id,
      { $set: { nextCheckAt: new Date(Date.now() + retryDelay(claimed.dispatchAttempts)) } },
      { new: true },
    );
  }
};

/** Bring one payout up to date with Cashfree (runner, admin "check now", webhook). */
export const syncPayout = async (payoutId) => {
  const payout = await DoctorPayout.findById(payoutId);
  if (!payout) return null;
  if (payout.provider === 'manual') return payout; // nothing at Cashfree to check
  if (payout.status === 'approved') return dispatchPayout(payout._id);
  if (!['processing', 'success'].includes(payout.status)) return payout;
  try {
    const cf = await getTransfer(payout.transferId);
    if (!cf) {
      logger.error('doctor_payout_missing_at_cashfree', {
        action: 'doctor_payout_missing_at_cashfree',
        payoutId: String(payout._id),
      });
      return DoctorPayout.findByIdAndUpdate(
        payout._id,
        { $set: { nextCheckAt: new Date(Date.now() + CHECK_PROCESSING_MS) } },
        { new: true },
      );
    }
    return applyTransferStatus(payout._id, cf);
  } catch (error) {
    logger.warn('doctor_payout_sync_failed', {
      action: 'doctor_payout_sync_failed',
      payoutId: String(payout._id),
      error: error.message,
    });
    return DoctorPayout.findByIdAndUpdate(
      payout._id,
      { $set: { nextCheckAt: new Date(Date.now() + CHECK_PROCESSING_MS) } },
      { new: true },
    );
  }
};

/* ----------------------- Admin ledger corrections ---------------------- */

/** Reverse one earning (e.g. the patient was refunded after the session). */
export const reverseEarning = async (earningId, adminId, reason) =>
  inTransaction(async (session) => {
    const earning = await DoctorEarning.findById(earningId).session(session);
    if (!earning) throw new WalletError('Earning not found', 404, 'NOT_FOUND');
    if (earning.status === 'reversed')
      throw new WalletError('This earning is already reversed', 409, 'ALREADY_REVERSED');
    await lockWallet(earning.doctorId, session);
    earning.status = 'reversed';
    earning.reversedAt = new Date();
    earning.reversalReason = reason;
    earning.reversedBy = adminId;
    await earning.save({ session });
    return earning;
  });

/**
 * A manual credit (positive) or debit (negative) to a doctor's wallet,
 * withdrawable at once. A debit may take the balance below zero; future
 * earnings then pay it back before anything can be withdrawn.
 */
export const createAdjustment = async ({ doctorId, amountMinor, note, adminId }) =>
  inTransaction(async (session) => {
    await lockWallet(doctorId, session);
    const now = new Date();
    const [row] = await DoctorEarning.create(
      [
        {
          doctorId,
          type: 'adjustment',
          currency: WALLET_CURRENCY,
          grossMinor: amountMinor,
          commissionBps: 0,
          commissionSource: 'none',
          commissionMinor: 0,
          netMinor: amountMinor,
          status: 'active',
          paidAt: now,
          completedAt: now,
          availableAt: now,
          note,
          createdBy: adminId,
        },
      ],
      { session },
    );
    return row;
  });

/* ----------------------------- Reconciler ------------------------------ */

/**
 * Repair what a failed hook missed, since earningsStartAt (all history by
 * default, so this is also what brings sessions paid before the wallet
 * existed into it):
 * - paid consultations with no earning → create it;
 * - completed ones still on indefinite hold → start the hold;
 * - cancelled ones still owed → reverse.
 * Every step is idempotent.
 */
export const reconcileEarnings = async () => {
  const settings = await getPayoutSettings();
  const since = settings.earningsStartAt;
  const stats = { created: 0, released: 0, autoReleased: 0, reversed: 0 };

  const cursor = Consultation.find({
    paymentStatus: 'paid',
    status: { $in: ['paid', 'active', 'completed'] },
    $or: [{ startedAt: { $gte: since } }, { startedAt: null, updatedAt: { $gte: since } }],
  })
    .select('_id doctorId status paymentStatus amountPaid currency startedAt completedAt updatedAt')
    .lean()
    .cursor({ batchSize: 500 });

  let batch = [];
  const flush = async () => {
    if (batch.length === 0) return;
    const earnings = await DoctorEarning.find({
      type: 'consultation',
      consultationId: { $in: batch.map((c) => c._id) },
    })
      .select('consultationId availableAt status')
      .lean();
    const byConsultation = new Map(earnings.map((e) => [String(e.consultationId), e]));
    for (const c of batch) {
      const earning = byConsultation.get(String(c._id));
      if (!earning) {
        if (await recordConsultationEarning(c, { settings })) stats.created += 1;
      } else if (c.status === 'completed' && earning.status === 'active' && !earning.availableAt) {
        if (await releaseConsultationEarning(c._id, c.completedAt || new Date()))
          stats.released += 1;
      }
    }
    batch = [];
  };
  for await (const c of cursor) {
    batch.push(c);
    if (batch.length >= 500) await flush();
  }
  await flush();

  // Paid sessions nobody marked completed: withdrawable autoReleaseDays
  // after payment (this is also what frees sessions paid long ago).
  if (settings.autoReleaseDays > 0) {
    const now = new Date();
    const released = await DoctorEarning.updateMany(
      {
        type: 'consultation',
        status: 'active',
        availableAt: null,
        paidAt: { $lte: new Date(now.getTime() - settings.autoReleaseDays * 86_400_000) },
      },
      { $set: { availableAt: now } },
    );
    stats.autoReleased = released.modifiedCount || 0;
  }

  // Cancelled sessions whose earning is still owed (never completed).
  const owed = await DoctorEarning.find({
    type: 'consultation',
    status: 'active',
    completedAt: null,
  })
    .select('consultationId')
    .lean();
  if (owed.length) {
    const cancelled = await Consultation.find({
      _id: { $in: owed.map((e) => e.consultationId) },
      status: 'cancelled',
    })
      .select('_id')
      .lean();
    stats.reversed = await reverseConsultationEarnings(
      cancelled.map((c) => c._id),
      'Consultation cancelled',
    );
  }

  if (Object.values(stats).some(Boolean)) {
    logger.warn('doctor_earnings_reconciled', { action: 'doctor_earnings_reconciled', ...stats });
  }
  return stats;
};

/** Payouts due a status check or a (re)dispatch. */
export const syncDuePayouts = async ({ limit = 50 } = {}) => {
  const due = await DoctorPayout.find({
    status: { $in: ['approved', 'processing'] },
    provider: { $ne: 'manual' },
    $or: [{ nextCheckAt: null }, { nextCheckAt: { $lte: new Date() } }],
  })
    .sort({ nextCheckAt: 1 })
    .limit(limit)
    .select('_id')
    .lean();
  for (const { _id } of due) await syncPayout(_id);
  return due.length;
};
