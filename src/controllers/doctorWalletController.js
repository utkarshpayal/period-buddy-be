import Doctor from '../models/Doctor.js';
import DoctorEarning from '../models/DoctorEarning.js';
import DoctorPayout from '../models/DoctorPayout.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { buildPagination, getPagination, isValidObjectId } from '../utils/apiHelpers.js';
import { comparePassword } from '../utils/password.js';
import {
  WalletError,
  addPayoutMethod,
  cancelPayout,
  computeWallet,
  describeWallet,
  getPayoutSettings,
  listPayoutMethods,
  payoutProviderFor,
  removePayoutMethod,
  requestPayout,
  setDefaultPayoutMethod,
} from '../utils/doctorWallet.js';
import {
  bpsToPercent,
  effectiveCommissionBps,
  fromMinor,
  toMinor,
  validatePayoutMethodInput,
} from '../utils/payoutMath.js';
import logger from '../utils/logger.js';

/**
 * Clinician portal: wallet, payout methods and withdrawals
 * (/api/doctor/wallet/*). Money logic lives in utils/doctorWallet.js.
 */

const loadDoctor = async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.userId }).select('+commissionBps');
  if (!doctor) sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
  return doctor;
};

/** WalletError → its status; anything else → next(). */
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

export const describePayout = (p) => ({
  _id: p._id,
  amount: fromMinor(p.amountMinor),
  currency: p.currency,
  status: p.status,
  method: p.method,
  utr: p.utr,
  failureReason: p.failureReason,
  reviewNote: p.reviewNote,
  createdAt: p.createdAt,
  approvedAt: p.approvedAt,
  completedAt: p.completedAt,
  events: p.events,
});

export const describeEarning = (e) => ({
  _id: e._id,
  type: e.type,
  consultationId: e.consultationId,
  currency: e.currency,
  gross: fromMinor(e.grossMinor),
  commissionPercent: bpsToPercent(e.commissionBps),
  commission: fromMinor(e.commissionMinor),
  net: fromMinor(e.netMinor),
  status: e.status,
  paidAt: e.paidAt,
  completedAt: e.completedAt,
  availableAt: e.availableAt,
  reversalReason: e.reversalReason,
  note: e.note,
  createdAt: e.createdAt,
});

/** GET /api/doctor/wallet — balances, rules that apply, methods, recent adjustments. */
export const getWallet = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    const [settings, wallet, methods, adjustments] = await Promise.all([
      getPayoutSettings(),
      computeWallet(doctor._id),
      listPayoutMethods(doctor._id),
      DoctorEarning.find({ doctorId: doctor._id, type: 'adjustment' })
        .sort({ createdAt: -1 })
        .limit(20)
        .lean(),
    ]);
    const { bps } = effectiveCommissionBps(doctor, settings);
    return sendResponse(res, HTTP_STATUS.OK, 'Wallet fetched', {
      wallet: describeWallet(wallet),
      rules: {
        commissionPercent: bpsToPercent(bps),
        holdDays: settings.holdDays,
        minWithdrawal: fromMinor(settings.minWithdrawalMinor),
        maxWithdrawal: fromMinor(settings.maxWithdrawalMinor),
        // Manual payouts need no provider, so this is just the admin's switch.
        payoutsEnabled: settings.payoutsEnabled,
        provider: payoutProviderFor(settings),
        requireApproval: settings.requireApproval,
        newMethodCooldownHours: settings.newMethodCooldownHours,
      },
      methods,
      adjustments: adjustments.map(describeEarning),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/doctor/wallet/payouts?page=&limit= */
export const getMyPayouts = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const filter = { doctorId: doctor._id };
    const [payouts, total] = await Promise.all([
      DoctorPayout.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
      DoctorPayout.countDocuments(filter),
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Payouts fetched', {
      payouts: payouts.map(describePayout),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/wallet/payouts — body { amount, methodId }, header Idempotency-Key. */
export const createPayoutRequest = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    const amount = Number(req.body?.amount);
    // Whole paise only: "100.005" is not an amount anyone meant.
    if (
      !Number.isFinite(amount) ||
      amount <= 0 ||
      Math.abs(toMinor(amount) - amount * 100) > 1e-6
    ) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Enter a valid amount (up to 2 decimals)');
    }
    if (!isValidObjectId(req.body?.methodId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Choose a payout method');
    }
    const { payout, replayed } = await requestPayout({
      doctor,
      userId: req.userId,
      amountMinor: toMinor(amount),
      methodId: req.body.methodId,
      idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
    });
    return sendResponse(
      res,
      replayed ? HTTP_STATUS.OK : HTTP_STATUS.CREATED,
      replayed ? 'Withdrawal already requested' : 'Withdrawal requested',
      describePayout(payout),
    );
  } catch (error) {
    handle(res, next, error);
  }
};

/** POST /api/doctor/wallet/payouts/:id/cancel — only while awaiting approval. */
export const cancelMyPayout = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const payout = await cancelPayout(doctor, req.params.id);
    return sendResponse(res, HTTP_STATUS.OK, 'Withdrawal cancelled', describePayout(payout));
  } catch (error) {
    handle(res, next, error);
  }
};

/** POST /api/doctor/wallet/methods — add a bank account / UPI ID (password required). */
export const addMethod = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    const user = await User.findById(req.userId).select('+password');
    const password = req.body?.password;
    if (!user?.password || !password || !(await comparePassword(password, user.password))) {
      // 403, not 401: the portal signs out on any 401.
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Your password is not correct');
    }
    const { value, error } = validatePayoutMethodInput(req.body);
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);

    const method = await addPayoutMethod(doctor, value);
    logger.info('doctor_payout_method_added', {
      action: 'doctor_payout_method_added',
      doctorId: String(doctor._id),
      methodId: String(method._id),
      type: method.type,
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Payout method added', method);
  } catch (error) {
    handle(res, next, error);
  }
};

/** DELETE /api/doctor/wallet/methods/:id */
export const removeMethod = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const method = await removePayoutMethod(doctor, req.params.id);
    logger.info('doctor_payout_method_removed', {
      action: 'doctor_payout_method_removed',
      doctorId: String(doctor._id),
      methodId: String(method._id),
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Payout method removed', method);
  } catch (error) {
    handle(res, next, error);
  }
};

/** POST /api/doctor/wallet/methods/:id/default */
export const makeDefaultMethod = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid id');
    const method = await setDefaultPayoutMethod(doctor, req.params.id);
    return sendResponse(res, HTTP_STATUS.OK, 'Default payout method set', method);
  } catch (error) {
    handle(res, next, error);
  }
};
