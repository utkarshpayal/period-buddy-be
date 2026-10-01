import mongoose from 'mongoose';
import ClinicalPayoutSettings from '../models/ClinicalPayoutSettings.js';
import Doctor from '../models/Doctor.js';
import DoctorEarning from '../models/DoctorEarning.js';
import DoctorPayout from '../models/DoctorPayout.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
} from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import {
  WalletError,
  approvePayout,
  computeWallet,
  createAdjustment,
  describeSettings,
  describeWallet,
  getPayoutMethodDetails,
  getPayoutSettings,
  markPayoutPaid,
  reconcileEarnings,
  rejectPayout,
  reverseEarning,
  syncPayout,
} from '../utils/doctorWallet.js';
import {
  bpsToPercent,
  effectiveCommissionBps,
  fromMinor,
  percentToBps,
  toMinor,
} from '../utils/payoutMath.js';
import { describeEarning, describePayout } from './doctorWalletController.js';
import { isPayoutConfigured } from '../utils/cashfreePayoutClient.js';

/**
 * Clinical Admin: commission rules, the earnings ledger and the payout queue
 * (/api/admin/clinical-finance/*, payouts.read / payouts.manage). Every write
 * is audited.
 */

const handle = (res, next, error) => {
  if (error instanceof WalletError) {
    return res.status(error.status).json({
      success: false,
      statusCode: error.status,
      message: error.message,
      code: error.code,
    });
  }
  return next(error);
};

const cleanNote = (v, max = 300) =>
  String(v ?? '')
    .trim()
    .slice(0, max);

/* ------------------------------- Settings ------------------------------ */

/** GET /settings */
export const getSettings = async (req, res, next) => {
  try {
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Settings fetched',
      describeSettings(await getPayoutSettings()),
    );
  } catch (error) {
    next(error);
  }
};

/** PUT /settings — any subset of the describeSettings() fields that are editable. */
export const updateSettings = async (req, res, next) => {
  try {
    const b = req.body || {};
    const $set = {};
    const bad = (msg) => sendError(res, HTTP_STATUS.BAD_REQUEST, msg);

    if (b.defaultCommissionPercent !== undefined) {
      const bps = percentToBps(b.defaultCommissionPercent);
      if (bps === null) return bad('Commission must be between 0 and 100%');
      $set.defaultCommissionBps = bps;
    }
    if (b.holdDays !== undefined) {
      const n = Number(b.holdDays);
      if (!Number.isInteger(n) || n < 0 || n > 60) return bad('Hold period must be 0 to 60 days');
      $set.holdDays = n;
    }
    if (b.newMethodCooldownHours !== undefined) {
      const n = Number(b.newMethodCooldownHours);
      if (!Number.isInteger(n) || n < 0 || n > 168) return bad('Cooldown must be 0 to 168 hours');
      $set.newMethodCooldownHours = n;
    }
    if (b.payoutProvider !== undefined) {
      if (!['manual', 'cashfree'].includes(b.payoutProvider)) return bad('Unknown payout method');
      if (b.payoutProvider === 'cashfree' && !isPayoutConfigured()) {
        return bad('Cashfree Payouts is not connected on the server yet (CASHFREE_PAYOUT_* keys)');
      }
      $set.payoutProvider = b.payoutProvider;
    }
    if (b.autoReleaseDays !== undefined) {
      const n = Number(b.autoReleaseDays);
      if (!Number.isInteger(n) || n < 0 || n > 90) return bad('Auto-release must be 0 to 90 days');
      $set.autoReleaseDays = n;
    }
    for (const key of ['payoutsEnabled', 'requireApproval']) {
      if (b[key] !== undefined) {
        if (typeof b[key] !== 'boolean') return bad(`${key} must be true or false`);
        $set[key] = b[key];
      }
    }
    const current = await getPayoutSettings();
    const min =
      b.minWithdrawal !== undefined ? toMinor(b.minWithdrawal) : current.minWithdrawalMinor;
    const max =
      b.maxWithdrawal !== undefined ? toMinor(b.maxWithdrawal) : current.maxWithdrawalMinor;
    // Cashfree's minimum transfer is ₹1.
    if (!(min >= 100) || !(max >= 100)) return bad('Withdrawal limits must be at least ₹1');
    if (min > max) return bad('Minimum withdrawal cannot be more than the maximum');
    if (b.minWithdrawal !== undefined) $set.minWithdrawalMinor = min;
    if (b.maxWithdrawal !== undefined) $set.maxWithdrawalMinor = max;

    if (Object.keys($set).length === 0) return bad('Nothing to update');
    $set.updatedBy = req.userId;

    const updated = await ClinicalPayoutSettings.findOneAndUpdate(
      { key: 'default' },
      { $set },
      { new: true },
    ).lean();
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.PAYOUT_SETTINGS_UPDATED,
      resourceType: 'clinical_payout_settings',
      resourceId: updated._id,
      metadata: {
        fields: Object.keys($set).filter((k) => k !== 'updatedBy'),
        before: describeSettings(current),
        after: describeSettings(updated),
      },
    });
    // A shorter auto-release frees earnings now, not at the next runner tick.
    if ($set.autoReleaseDays !== undefined) {
      reconcileEarnings().catch(() => {});
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Settings saved', describeSettings(updated));
  } catch (error) {
    next(error);
  }
};

/* ------------------------------- Overview ------------------------------ */

/** GET /overview — platform-wide totals. */
export const getOverview = async (req, res, next) => {
  try {
    const now = new Date();
    const [earnings, payouts, settings] = await Promise.all([
      DoctorEarning.aggregate([
        { $match: { status: 'active', currency: 'INR' } },
        {
          $group: {
            _id: null,
            gross: { $sum: { $cond: [{ $eq: ['$type', 'consultation'] }, '$grossMinor', 0] } },
            commission: { $sum: '$commissionMinor' },
            net: { $sum: '$netMinor' },
            onHold: {
              $sum: {
                $cond: [
                  { $or: [{ $eq: ['$availableAt', null] }, { $gt: ['$availableAt', now] }] },
                  '$netMinor',
                  0,
                ],
              },
            },
            sessions: { $sum: { $cond: [{ $eq: ['$type', 'consultation'] }, 1, 0] } },
          },
        },
      ]),
      DoctorPayout.aggregate([
        { $match: { currency: 'INR' } },
        { $group: { _id: '$status', total: { $sum: '$amountMinor' }, count: { $sum: 1 } } },
      ]),
      getPayoutSettings(),
    ]);
    const e = earnings[0] || {};
    const p = Object.fromEntries(payouts.map((row) => [row._id, row]));
    const amt = (s) => p[s]?.total || 0;
    const debited = amt('requested') + amt('approved') + amt('processing') + amt('success');
    return sendResponse(res, HTTP_STATUS.OK, 'Overview fetched', {
      currency: 'INR',
      gross: fromMinor(e.gross),
      commission: fromMinor(e.commission),
      doctorNet: fromMinor(e.net),
      onHold: fromMinor(e.onHold),
      // What doctors could withdraw right now, summed (net of open requests).
      owedAvailable: fromMinor((e.net || 0) - (e.onHold || 0) - debited),
      paidOut: fromMinor(amt('success')),
      inFlight: fromMinor(amt('approved') + amt('processing')),
      awaitingApproval: { count: p.requested?.count || 0, amount: fromMinor(amt('requested')) },
      failedCount: (p.failed?.count || 0) + (p.reversed?.count || 0),
      sessions: e.sessions || 0,
      settings: describeSettings(settings),
    });
  } catch (error) {
    next(error);
  }
};

/* ------------------------------- Doctors ------------------------------- */

/** GET /doctors?page=&search= — each doctor's rate and wallet. */
export const listDoctorWallets = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 50 });
    const filter = {};
    if (req.query.search) {
      const rx = { $regex: escapeRegex(req.query.search), $options: 'i' };
      filter.$or = [{ name: rx }, { email: rx }];
    }
    const [doctors, total, settings] = await Promise.all([
      Doctor.find(filter)
        .select('+commissionBps name email specialty pricePerSession currency isAvailable')
        .sort({ name: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Doctor.countDocuments(filter),
      getPayoutSettings(),
    ]);
    const rows = await Promise.all(
      doctors.map(async (d) => {
        const { bps, source } = effectiveCommissionBps(d, settings);
        return {
          _id: d._id,
          name: d.name,
          email: d.email,
          specialty: d.specialty,
          pricePerSession: d.pricePerSession,
          currency: d.currency,
          isAvailable: d.isAvailable,
          commissionPercent: bpsToPercent(bps),
          commissionOverridePercent: d.commissionBps == null ? null : bpsToPercent(d.commissionBps),
          commissionSource: source,
          wallet: describeWallet(await computeWallet(d._id)),
        };
      }),
    );
    return sendResponse(res, HTTP_STATUS.OK, 'Doctors fetched', {
      doctors: rows,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /doctors/:id/commission — { commissionPercent: number | null } (null = use default). */
export const setDoctorCommission = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    const raw = req.body?.commissionPercent;
    let bps = null;
    if (raw !== null && raw !== '' && raw !== undefined) {
      bps = percentToBps(raw);
      if (bps === null)
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Commission must be between 0 and 100%');
    }
    const before = await Doctor.findById(req.params.id).select('+commissionBps name').lean();
    if (!before) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');
    await Doctor.updateOne({ _id: before._id }, { $set: { commissionBps: bps } });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_COMMISSION_UPDATED,
      resourceType: 'doctor',
      resourceId: before._id,
      metadata: {
        beforePercent: before.commissionBps == null ? null : bpsToPercent(before.commissionBps),
        afterPercent: bps == null ? null : bpsToPercent(bps),
      },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Commission updated', {
      _id: before._id,
      commissionOverridePercent: bps == null ? null : bpsToPercent(bps),
    });
  } catch (error) {
    next(error);
  }
};

/* ------------------------------- Earnings ------------------------------ */

/** GET /earnings?doctorId=&type=&status=&page= */
export const listEarnings = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 25, maxLimit: 100 });
    const filter = {};
    if (req.query.doctorId) {
      if (!isValidObjectId(req.query.doctorId))
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
      filter.doctorId = new mongoose.Types.ObjectId(req.query.doctorId);
    }
    if (['consultation', 'adjustment'].includes(req.query.type)) filter.type = req.query.type;
    const now = new Date();
    if (req.query.status === 'reversed') filter.status = 'reversed';
    else if (req.query.status === 'on_hold')
      Object.assign(filter, {
        status: 'active',
        $or: [{ availableAt: null }, { availableAt: { $gt: now } }],
      });
    else if (req.query.status === 'available')
      Object.assign(filter, { status: 'active', availableAt: { $lte: now } });

    const [rows, total] = await Promise.all([
      DoctorEarning.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('doctorId', 'name')
        .lean(),
      DoctorEarning.countDocuments(filter),
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Earnings fetched', {
      earnings: rows.map((e) => ({
        ...describeEarning(e),
        doctor: e.doctorId ? { _id: e.doctorId._id, name: e.doctorId.name } : null,
      })),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /earnings/:id/reverse — { reason } */
export const reverseEarningById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const reason = cleanNote(req.body?.reason);
    if (reason.length < 3)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Give a reason for the reversal');
    const earning = await reverseEarning(req.params.id, req.userId, reason);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_EARNING_REVERSED,
      resourceType: 'doctor_earning',
      resourceId: earning._id,
      metadata: { doctorId: String(earning.doctorId), net: fromMinor(earning.netMinor), reason },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Earning reversed', describeEarning(earning));
  } catch (error) {
    handle(res, next, error);
  }
};

/** POST /adjustments — { doctorId, amount (positive credit / negative debit), note } */
export const addAdjustment = async (req, res, next) => {
  try {
    const { doctorId } = req.body || {};
    if (!isValidObjectId(doctorId))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Choose a doctor');
    const amount = Number(req.body?.amount);
    const amountMinor = toMinor(amount);
    if (!Number.isFinite(amount) || amountMinor === 0 || Math.abs(amountMinor) > 10_000_000) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'Amount must be non-zero and at most ₹1,00,000',
      );
    }
    const note = cleanNote(req.body?.note);
    if (note.length < 3)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Add a note explaining the adjustment');
    if (!(await Doctor.exists({ _id: doctorId })))
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    const row = await createAdjustment({ doctorId, amountMinor, note, adminId: req.userId });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_WALLET_ADJUSTED,
      resourceType: 'doctor_earning',
      resourceId: row._id,
      metadata: { doctorId: String(doctorId), amount: fromMinor(amountMinor), note },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Adjustment added', describeEarning(row));
  } catch (error) {
    handle(res, next, error);
  }
};

/* -------------------------------- Payouts ------------------------------ */

/** GET /payouts?status=&doctorId=&page= */
export const listPayouts = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 25, maxLimit: 100 });
    const filter = {};
    const statuses = String(req.query.status || '')
      .split(',')
      .filter((s) =>
        [
          'requested',
          'approved',
          'processing',
          'success',
          'failed',
          'rejected',
          'cancelled',
          'reversed',
        ].includes(s),
      );
    if (statuses.length) filter.status = { $in: statuses };
    if (req.query.doctorId) {
      if (!isValidObjectId(req.query.doctorId))
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
      filter.doctorId = req.query.doctorId;
    }
    const [rows, total] = await Promise.all([
      DoctorPayout.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('doctorId', 'name email')
        .lean(),
      DoctorPayout.countDocuments(filter),
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Payouts fetched', {
      payouts: rows.map((p) => ({
        ...describePayout(p),
        doctor: p.doctorId
          ? { _id: p.doctorId._id, name: p.doctorId.name, email: p.doctorId.email }
          : null,
        provider: p.provider || 'cashfree',
        transferId: p.transferId,
        cfStatus: p.cfStatus,
        cfStatusCode: p.cfStatusCode,
        dispatchAttempts: p.dispatchAttempts,
      })),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /payouts/:id/approve — approve and send to Cashfree. */
export const approvePayoutById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const payout = await approvePayout(req.params.id, req.userId);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_PAYOUT_APPROVED,
      resourceType: 'doctor_payout',
      resourceId: req.params.id,
      metadata: { amount: fromMinor(payout?.amountMinor), status: payout?.status },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Withdrawal approved', describePayout(payout));
  } catch (error) {
    handle(res, next, error);
  }
};

/** POST /payouts/:id/reject — { note } */
export const rejectPayoutById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const note = cleanNote(req.body?.note);
    if (note.length < 3)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Tell the doctor why it was declined');
    const payout = await rejectPayout(req.params.id, req.userId, note);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_PAYOUT_REJECTED,
      resourceType: 'doctor_payout',
      resourceId: payout._id,
      metadata: { amount: fromMinor(payout.amountMinor), note },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Withdrawal declined', describePayout(payout));
  } catch (error) {
    handle(res, next, error);
  }
};

/** POST /payouts/:id/sync — check with Cashfree now (or retry a deferred send). */
export const syncPayoutById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const payout = await syncPayout(req.params.id);
    if (!payout) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Withdrawal not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Withdrawal checked', describePayout(payout));
  } catch (error) {
    handle(res, next, error);
  }
};

/** POST /payouts/:id/mark-paid — { reference, note? } for a manual withdrawal
 * you have already transferred from the bank. */
export const markPayoutPaidById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const reference = cleanNote(req.body?.reference, 64);
    if (!/^[A-Za-z0-9 _/-]{4,64}$/.test(reference)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'Enter the bank reference / UTR of the transfer',
      );
    }
    const note = cleanNote(req.body?.note) || undefined;
    const payout = await markPayoutPaid(req.params.id, req.userId, reference, note);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_PAYOUT_MARKED_PAID,
      resourceType: 'doctor_payout',
      resourceId: payout._id,
      metadata: { amount: fromMinor(payout.amountMinor), reference },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Marked as paid', describePayout(payout));
  } catch (error) {
    handle(res, next, error);
  }
};

/** GET /payouts/:id/method — full bank / UPI details to pay a withdrawal by
 * hand. Every view is audited. */
export const getPayoutMethodById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const details = await getPayoutMethodDetails(req.params.id);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_PAYOUT_METHOD_VIEWED,
      resourceType: 'doctor_payout',
      resourceId: req.params.id,
    });
    res.set('Cache-Control', 'no-store');
    return sendResponse(res, HTTP_STATUS.OK, 'Payout details', details);
  } catch (error) {
    handle(res, next, error);
  }
};
