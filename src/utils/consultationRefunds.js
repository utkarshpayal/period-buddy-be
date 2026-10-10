import Consultation from '../models/Consultation.js';
import Notification from '../models/Notification.js';
import logger from './logger.js';
import {
  CashfreeApiError,
  createRefund,
  getRefund,
  isPaymentConfigured,
} from './cashfreeClient.js';

/**
 * Automatic refunds for cancelled paid consultations, through the Cashfree
 * Refunds API on the consultation's own order (money goes back to the card /
 * UPI / bank it came from).
 *
 * A cancellation sets `refundStatus: 'required'` (utils/consultationLifecycle.js)
 * and calls `requestConsultationRefund`. `refundAuto` tracks the attempt; the
 * payout runner (`syncConsultationRefunds`, every 2 min) retries failures and
 * checks pending ones, and Cashfree's refund webhook speeds that up. Only when
 * Cashfree reports SUCCESS does `refundStatus` become 'processed'. Anything
 * that can't be automatic (no Cashfree order) or keeps failing stays in the
 * admin Refunds queue, where it can be retried or marked by hand.
 *
 * Never refunds twice: one worker at a time per consultation (`lockedUntil`),
 * the refund id is fixed per consultation so a retry after a lost response
 * finds the first refund instead of sending another, and Cashfree itself
 * refuses refunds beyond the order amount. Off with CASHFREE_AUTO_REFUNDS=false.
 */

export const MAX_REFUND_ATTEMPTS = 5;
const LOCK_MS = 2 * 60_000;
/** Wait before attempt n+1 after n failures: 2 min, 15 min, 1 h, 6 h. */
const RETRY_DELAYS_MS = [2 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
/** How often a refund Cashfree still has as PENDING is re-checked. */
const PENDING_RECHECK_MS = 5 * 60_000;

export const autoRefundsEnabled = () =>
  isPaymentConfigured() && process.env.CASHFREE_AUTO_REFUNDS !== 'false';

/** Our refund id for a consultation: fixed, so a retry can find the first one.
 * A later one after Cashfree cancelled a refund gets a suffix. */
export const refundIdFor = (consultationId, round = 0) =>
  `refund_${consultationId}${round ? `_${round}` : ''}`;

/** Delay before the next try after `attempts` failures, or null when out of tries. */
export const retryDelayMs = (attempts) =>
  attempts >= MAX_REFUND_ATTEMPTS
    ? null
    : RETRY_DELAYS_MS[Math.min(Math.max(attempts, 1), RETRY_DELAYS_MS.length) - 1];

/** What a Cashfree refund entity means for us. */
export const outcomeOf = (refund) => {
  const providerStatus = String(refund?.refund_status || '').toUpperCase();
  const base = {
    providerStatus,
    cfRefundId: refund?.cf_refund_id != null ? String(refund.cf_refund_id) : undefined,
  };
  if (providerStatus === 'SUCCESS') {
    return {
      ...base,
      status: 'success',
      reference: refund.refund_arn || base.cfRefundId || refund.refund_id,
      processedAt: refund.processed_at || refund.refund_processed_at || null,
    };
  }
  if (providerStatus === 'CANCELLED') {
    return {
      ...base,
      status: 'failed',
      error: refund?.status_description || 'Cashfree cancelled the refund',
    };
  }
  // PENDING, ONHOLD, or anything new: Cashfree is still working on it.
  return { ...base, status: 'pending' };
};

const isAlreadyExists = (error) =>
  error instanceof CashfreeApiError &&
  (error.status === 409 || /already.?exist/i.test(`${error.code} ${error.message}`));

const isNotFound = (error) => error instanceof CashfreeApiError && error.status === 404;

const notifyRefunded = async (consultation) => {
  try {
    await Notification.create({
      userId: consultation.userId,
      type: 'consultation_update',
      title: 'Refund on its way',
      body: `₹${consultation.amountPaid} has been refunded to your original payment method. It usually shows in your account within 5–7 working days.`,
      data: { consultationId: String(consultation._id) },
      sentAt: new Date(),
    });
  } catch (error) {
    logger.error('consultation_refund_notify_failed', {
      action: 'consultation_refund_notify_failed',
      consultationId: String(consultation._id),
      error: error.message,
    });
  }
};

/** Record what Cashfree said about the refund, and finish it on SUCCESS. */
const applyOutcome = async (consultation, outcome, { attempts, refundId }) => {
  const now = new Date();
  const auto = {
    'refundAuto.refundId': refundId,
    'refundAuto.providerStatus': outcome.providerStatus,
    'refundAuto.checkedAt': now,
    ...(outcome.cfRefundId ? { 'refundAuto.cfRefundId': outcome.cfRefundId } : {}),
  };

  if (outcome.status === 'success') {
    const done = await Consultation.findOneAndUpdate(
      { _id: consultation._id, refundStatus: 'required' },
      {
        $set: {
          ...auto,
          'refundAuto.status': 'success',
          refundStatus: 'processed',
          paymentStatus: 'refunded',
          refundedAt: outcome.processedAt ? new Date(outcome.processedAt) : now,
          refundReference: String(outcome.reference || refundId).slice(0, 120),
        },
        $unset: {
          'refundAuto.lockedUntil': 1,
          'refundAuto.nextAttemptAt': 1,
          'refundAuto.lastError': 1,
        },
      },
      { new: true },
    );
    if (done) {
      logger.info('consultation_refund_succeeded', {
        action: 'consultation_refund_succeeded',
        consultationId: String(done._id),
        amount: done.amountPaid,
        refundId,
        reference: done.refundReference,
      });
      await notifyRefunded(done);
    }
    return 'success';
  }

  if (outcome.status === 'pending') {
    await Consultation.updateOne(
      { _id: consultation._id, refundStatus: 'required' },
      {
        $set: { ...auto, 'refundAuto.status': 'pending' },
        $unset: {
          'refundAuto.lockedUntil': 1,
          'refundAuto.nextAttemptAt': 1,
          'refundAuto.lastError': 1,
        },
      },
    );
    return 'pending';
  }

  return recordFailure(consultation, outcome.error, { attempts, extra: auto });
};

const recordFailure = async (consultation, message, { attempts, extra = {} }) => {
  const delay = retryDelayMs(attempts);
  await Consultation.updateOne(
    { _id: consultation._id, refundStatus: 'required' },
    {
      $set: {
        ...extra,
        'refundAuto.status': 'failed',
        'refundAuto.lastError': String(message || 'Refund failed').slice(0, 300),
        ...(delay ? { 'refundAuto.nextAttemptAt': new Date(Date.now() + delay) } : {}),
      },
      $unset: { 'refundAuto.lockedUntil': 1, ...(delay ? {} : { 'refundAuto.nextAttemptAt': 1 }) },
    },
  );
  logger.warn('consultation_refund_failed', {
    action: 'consultation_refund_failed',
    consultationId: String(consultation._id),
    attempts,
    willRetry: Boolean(delay),
    error: message,
  });
  return 'failed';
};

/** Claim a consultation for one refund step, or null if it's not due / taken. */
const claim = (consultationId, due) => {
  const now = new Date();
  return Consultation.findOneAndUpdate(
    {
      _id: consultationId,
      refundStatus: 'required',
      paymentStatus: 'paid',
      $and: [
        due,
        {
          $or: [
            { 'refundAuto.lockedUntil': { $exists: false } },
            { 'refundAuto.lockedUntil': { $lt: now } },
          ],
        },
      ],
    },
    { $set: { 'refundAuto.lockedUntil': new Date(now.getTime() + LOCK_MS) } },
    { new: true },
  );
};

const DUE_TO_SEND = () => ({
  $or: [
    { 'refundAuto.status': { $exists: false } },
    {
      'refundAuto.status': 'failed',
      'refundAuto.attempts': { $lt: MAX_REFUND_ATTEMPTS },
      $or: [
        { 'refundAuto.nextAttemptAt': { $exists: false } },
        { 'refundAuto.nextAttemptAt': { $lte: new Date() } },
      ],
    },
  ],
});

/**
 * Send (or resume) the refund for one cancelled paid consultation. Safe to
 * call any number of times, from anywhere; never throws. Returns 'success',
 * 'pending', 'failed', 'skipped', or null when there was nothing to do.
 */
export const requestConsultationRefund = async (consultationId) => {
  if (!autoRefundsEnabled()) return null;
  let consultation;
  try {
    consultation = await claim(consultationId, DUE_TO_SEND());
    if (!consultation) return null;

    if (!consultation.cashfreeOrderId || !(consultation.amountPaid > 0)) {
      await Consultation.updateOne(
        { _id: consultation._id },
        {
          $set: {
            'refundAuto.status': 'skipped',
            'refundAuto.lastError': consultation.cashfreeOrderId
              ? 'Nothing was paid, so there is nothing to refund automatically.'
              : 'Not paid through Cashfree checkout, so it has to be refunded by hand.',
            'refundAuto.checkedAt': new Date(),
          },
          $unset: { 'refundAuto.lockedUntil': 1 },
        },
      );
      return 'skipped';
    }

    const attempts = (consultation.refundAuto?.attempts || 0) + 1;
    await Consultation.updateOne(
      { _id: consultation._id },
      { $set: { 'refundAuto.attempts': attempts } },
    );
    const orderId = consultation.cashfreeOrderId;
    let refundId = consultation.refundAuto?.refundId || refundIdFor(consultation._id);

    try {
      // A refund already sent (say its response was lost): pick it up rather
      // than sending another. Only a cancelled one is sent again, with a new id.
      let refund = null;
      if (consultation.refundAuto?.refundId) {
        try {
          refund = await getRefund({ orderId, refundId });
        } catch (error) {
          if (!isNotFound(error)) throw error;
        }
      }
      if (refund && String(refund.refund_status).toUpperCase() === 'CANCELLED') {
        refundId = refundIdFor(consultation._id, attempts);
        refund = null;
      }
      if (!refund) {
        await Consultation.updateOne(
          { _id: consultation._id },
          { $set: { 'refundAuto.refundId': refundId, 'refundAuto.requestedAt': new Date() } },
        );
        try {
          refund = await createRefund({
            orderId,
            refundId,
            amount: consultation.amountPaid,
            note: `Cancelled consultation ${String(consultation._id).slice(-8)}`,
          });
        } catch (error) {
          if (!isAlreadyExists(error)) throw error;
          refund = await getRefund({ orderId, refundId });
        }
      }
      return await applyOutcome(consultation, outcomeOf(refund), { attempts, refundId });
    } catch (error) {
      return await recordFailure(consultation, error.message, {
        attempts,
        extra: { 'refundAuto.refundId': refundId },
      });
    }
  } catch (error) {
    // Database trouble: the runner picks it up again once the lock lapses.
    logger.error('consultation_refund_error', {
      action: 'consultation_refund_error',
      consultationId: String(consultationId),
      error: error.message,
    });
    return null;
  }
};

/** Re-check a refund Cashfree has as PENDING. Never throws. */
export const checkConsultationRefund = async (consultationId) => {
  if (!autoRefundsEnabled()) return null;
  try {
    const consultation = await claim(consultationId, { 'refundAuto.status': 'pending' });
    if (!consultation?.refundAuto?.refundId || !consultation.cashfreeOrderId) return null;
    const refund = await getRefund({
      orderId: consultation.cashfreeOrderId,
      refundId: consultation.refundAuto.refundId,
    });
    return await applyOutcome(consultation, outcomeOf(refund), {
      attempts: consultation.refundAuto.attempts || 1,
      refundId: consultation.refundAuto.refundId,
    });
  } catch (error) {
    await Consultation.updateOne(
      { _id: consultationId },
      { $set: { 'refundAuto.checkedAt': new Date() }, $unset: { 'refundAuto.lockedUntil': 1 } },
    ).catch(() => {});
    logger.warn('consultation_refund_check_failed', {
      action: 'consultation_refund_check_failed',
      consultationId: String(consultationId),
      error: error.message,
    });
    return null;
  }
};

/**
 * The runner's sweep (utils/payoutRunner.js): send refunds that are due
 * (new ones, e.g. from bulk cancellations, and failures whose retry time has
 * come) and re-check pending ones. A few per tick.
 */
export const syncConsultationRefunds = async ({ limit = 20 } = {}) => {
  if (!autoRefundsEnabled()) return;
  const due = await Consultation.find({
    refundStatus: 'required',
    paymentStatus: 'paid',
    ...DUE_TO_SEND(),
  })
    .select('_id')
    .sort({ completedAt: 1 })
    .limit(limit)
    .lean();
  for (const { _id } of due) await requestConsultationRefund(_id);

  const pending = await Consultation.find({
    refundStatus: 'required',
    'refundAuto.status': 'pending',
    'refundAuto.checkedAt': { $lt: new Date(Date.now() - PENDING_RECHECK_MS) },
  })
    .select('_id')
    .limit(limit)
    .lean();
  for (const { _id } of pending) await checkConsultationRefund(_id);
};

/** Admin "Retry": a fresh round of attempts for a failed or skipped refund. */
export const retryConsultationRefund = async (consultationId) => {
  const reset = await Consultation.findOneAndUpdate(
    {
      _id: consultationId,
      refundStatus: 'required',
      'refundAuto.status': { $in: ['failed', 'skipped'] },
    },
    {
      $set: { 'refundAuto.status': 'failed', 'refundAuto.attempts': 0 },
      $unset: { 'refundAuto.nextAttemptAt': 1, 'refundAuto.lockedUntil': 1 },
    },
    { new: true },
  );
  if (!reset) return null;
  return requestConsultationRefund(consultationId);
};

/** Cashfree refund webhook: find the consultation and re-read the refund from
 * Cashfree (the payload itself is never trusted for money state). */
export const handleRefundWebhook = async (payload) => {
  const orderId = payload?.data?.refund?.order_id;
  if (typeof orderId !== 'string' || !orderId.startsWith('consult_')) return 'ignored';
  const consultation = await Consultation.findOne({ cashfreeOrderId: orderId })
    .select('_id refundAuto')
    .lean();
  if (!consultation) return 'ignored';
  if (consultation.refundAuto?.status === 'pending')
    return (await checkConsultationRefund(consultation._id)) || 'none';
  return 'none';
};
