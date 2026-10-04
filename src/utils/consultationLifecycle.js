import Consultation from '../models/Consultation.js';
import ConsultationMessage from '../models/ConsultationMessage.js';
import Doctor from '../models/Doctor.js';
import Notification from '../models/Notification.js';
import User from '../models/User.js';
import logger from './logger.js';
import { broadcastToRoom } from '../config/websocket.js';
import {
  recordConsultationEarning,
  releaseConsultationEarning,
  reverseConsultationEarnings,
  safeEarningHook,
} from './doctorWallet.js';

/**
 * One place for what happens to a consultation over its life, so the patient,
 * the doctor and the system (doctor retired, late payment…) all cancel, pay
 * and refund the same way.
 */

/** Doctor fields a patient may see: no email, login account, keys or admin flags. */
const PRIVATE_DOCTOR_FIELDS = ['email', 'userId', 'avatarKey', 'commissionBps', 'deletedAt', '__v'];

export const publicDoctor = (doctor) => {
  if (!doctor || typeof doctor !== 'object') return doctor;
  const plain = typeof doctor.toJSON === 'function' ? doctor.toJSON() : { ...doctor };
  for (const field of PRIVATE_DOCTOR_FIELDS) delete plain[field];
  return plain;
};

/** A consultation as the patient sees it: public doctor, no legacy chat array or payment session. */
export const publicConsultation = (consultation) => {
  if (!consultation) return consultation;
  const plain =
    typeof consultation.toJSON === 'function' ? consultation.toJSON() : { ...consultation };
  delete plain.messages;
  delete plain.cashfreePaymentSessionId;
  if (plain.doctorId && typeof plain.doctorId === 'object' && plain.doctorId.name) {
    plain.doctorId = publicDoctor(plain.doctorId);
  }
  return plain;
};

const doctorGreeting = (doctor) =>
  `Hello! I am ${doctor.name}. Your confidential dashboard log has been successfully shared. How can I guide your wellness milestones today?`;

const formatWhen = (date) =>
  date
    ? new Intl.DateTimeFormat('en-IN', {
        timeZone: 'Asia/Kolkata',
        weekday: 'short',
        day: 'numeric',
        month: 'short',
        hour: 'numeric',
        minute: '2-digit',
      }).format(date) + ' IST'
    : null;

/** Tell a signed-in user's open app/portal (their personal `user_<id>` room). */
export const notifyUserLive = (userId, payload) => {
  if (userId) broadcastToRoom(`user_${userId}`, payload);
};

const notifyPatient = async (consultation, { title, body, data = {} }) => {
  try {
    await Notification.create({
      userId: consultation.userId,
      type: 'consultation_update',
      title,
      body,
      data: { consultationId: String(consultation._id), ...data },
      sentAt: new Date(),
    });
  } catch (error) {
    logger.error('consultation_notify_failed', {
      action: 'consultation_notify_failed',
      consultationId: String(consultation._id),
      error: error.message,
    });
  }
};

/**
 * Cancel one open consultation atomically (only from `fromStatuses`), with
 * the refund trail when it was paid: earning reversed, doctor's session count
 * corrected, `refundStatus: 'required'` for finance, both sides told.
 * Returns the cancelled consultation, or null when it wasn't cancellable.
 */
export const cancelConsultationRecord = async (
  filter,
  { by, reason, fromStatuses = ['pending', 'paid', 'active'], countedSession = true },
) => {
  const before = await Consultation.findOne({ ...filter, status: { $in: fromStatuses } });
  if (!before) return null;
  const wasPaid = before.paymentStatus === 'paid';

  const cancelled = await Consultation.findOneAndUpdate(
    { _id: before._id, status: { $in: fromStatuses } },
    {
      $set: {
        status: 'cancelled',
        completedAt: new Date(),
        cancelledBy: by,
        ...(reason ? { cancelReason: String(reason).slice(0, 300) } : {}),
        ...(wasPaid ? { refundStatus: 'required' } : {}),
      },
    },
    { new: true },
  );
  if (!cancelled) return null;

  await safeEarningHook('cancelled', () =>
    reverseConsultationEarnings(cancelled._id, reason || `Cancelled by the ${by}`),
  );

  const doctor = await Doctor.findById(cancelled.doctorId).select('name userId totalConsultations');
  // `countedSession: false` when the booking never reached the doctor's count.
  if (wasPaid && countedSession && doctor && doctor.totalConsultations > 0) {
    await Doctor.updateOne(
      { _id: doctor._id, totalConsultations: { $gt: 0 } },
      { $inc: { totalConsultations: -1 } },
    );
  }

  if (wasPaid) {
    logger.warn('consultation_refund_required', {
      action: 'consultation_refund_required',
      consultationId: String(cancelled._id),
      doctorId: String(cancelled.doctorId),
      patientId: String(cancelled.userId),
      amountPaid: cancelled.amountPaid,
      currency: cancelled.currency,
      cashfreeOrderId: cancelled.cashfreeOrderId,
      cancelledBy: by,
      reason,
    });
  }

  const doctorName = doctor?.name || 'Your doctor';
  const refundLine = wasPaid ? ' Your payment will be refunded.' : '';
  if (by !== 'patient') {
    await notifyPatient(cancelled, {
      title: 'Consultation cancelled',
      body:
        by === 'doctor'
          ? `${doctorName} cancelled your consultation${reason ? `: ${reason}` : ''}.${refundLine}`
          : `Your consultation with ${doctorName} was cancelled.${refundLine}`,
    });
  }
  const live = {
    event: 'consultation_cancelled',
    consultationId: String(cancelled._id),
    cancelledBy: by,
  };
  broadcastToRoom(`consultation_${cancelled._id}`, live);
  notifyUserLive(cancelled.userId, live);
  if (doctor?.userId) notifyUserLive(doctor.userId, live);

  return cancelled;
};

/** Paid sessions already holding the slot that starts at `scheduledFor`. */
export const slotTakenBy = (doctorId, scheduledFor, excludeId) =>
  Consultation.exists({
    _id: { $ne: excludeId },
    doctorId,
    scheduledFor,
    status: { $in: ['paid', 'active', 'completed'] },
  });

/**
 * Cashfree says `consultation`'s order is PAID: book it, once. Safe to call
 * from /verify, the webhook and the lazy repair in /my at the same time — only
 * the first claim (pending → paid) runs the side effects. A payment that lands
 * after the booking was cancelled, or for a slot someone else took meanwhile,
 * is recorded as paid and immediately cancelled with a refund due.
 * Returns `{ consultation, outcome }`, outcome one of 'booked' | 'already' |
 * 'refund' .
 */
export const finalizePaidConsultation = async (consultation) => {
  const claimed = await Consultation.findOneAndUpdate(
    { _id: consultation._id, status: 'pending' },
    { $set: { status: 'paid', paymentStatus: 'paid', startedAt: new Date() } },
    { new: true },
  );

  if (!claimed) {
    const current = await Consultation.findById(consultation._id);
    if (current?.status === 'cancelled' && current.paymentStatus !== 'paid') {
      // Cancelled before the money arrived (e.g. doctor retired): keep the
      // payment on record and queue the refund.
      current.paymentStatus = 'paid';
      current.refundStatus = 'required';
      await current.save();
      logger.warn('consultation_refund_required', {
        action: 'consultation_refund_required',
        consultationId: String(current._id),
        patientId: String(current.userId),
        amountPaid: current.amountPaid,
        cashfreeOrderId: current.cashfreeOrderId,
        reason: 'paid_after_cancel',
      });
      await notifyPatient(current, {
        title: 'Booking was cancelled',
        body: 'Your payment came through after this booking was cancelled. It will be refunded.',
      });
      return { consultation: current, outcome: 'refund' };
    }
    return { consultation: current, outcome: 'already' };
  }

  // The slot was given away while this checkout was unpaid past its hold.
  if (
    claimed.scheduledFor &&
    (await slotTakenBy(claimed.doctorId, claimed.scheduledFor, claimed._id))
  ) {
    const cancelled = await cancelConsultationRecord(
      { _id: claimed._id },
      {
        by: 'system',
        reason: 'That time was booked by someone else before your payment completed',
        fromStatuses: ['paid'],
        countedSession: false,
      },
    );
    return { consultation: cancelled || claimed, outcome: 'refund' };
  }

  const doctor = await Doctor.findById(claimed.doctorId);
  await ConsultationMessage.create({
    consultationId: claimed._id,
    sender: 'doctor',
    text: doctorGreeting(doctor || { name: 'your doctor' }),
  });
  await User.findByIdAndUpdate(claimed.userId, { $inc: { walletBalance: 10 } });
  await Doctor.findByIdAndUpdate(claimed.doctorId, { $inc: { totalConsultations: 1 } });
  await safeEarningHook('paid', () => recordConsultationEarning(claimed));

  if (doctor?.userId) {
    notifyUserLive(doctor.userId, {
      event: 'consultation_booked',
      consultationId: String(claimed._id),
      scheduledFor: claimed.scheduledFor,
    });
  }
  logger.info('consultation_booked', {
    action: 'consultation_booked',
    userId: String(claimed.userId),
    doctorId: String(claimed.doctorId),
    consultationId: String(claimed._id),
    scheduledFor: claimed.scheduledFor,
    when: formatWhen(claimed.scheduledFor),
    amount: claimed.amountPaid,
  });
  return { consultation: claimed, outcome: 'booked' };
};

/**
 * True once a booked session's slot has started. Cancelling (patient) and
 * completing (doctor) both turn on this, not on 'paid' vs 'active': a chat
 * message or a call moves a booking to 'active' days before its slot, and
 * that must not take away the patient's cancel/refund. Sessions booked before
 * slots existed (no `scheduledFor`) count as started.
 */
export const hasSessionStarted = (consultation, now = new Date()) =>
  !consultation?.scheduledFor || new Date(consultation.scheduledFor).getTime() <= now.getTime();

/** How long after its slot ends a session nobody closed is completed automatically. */
export const AUTO_COMPLETE_AFTER_MINUTES = 3 * 60;
/** Sessions from before slots existed: completed this long after payment. */
const LEGACY_AUTO_COMPLETE_DAYS = 7;

/**
 * Complete paid/active sessions whose slot ended AUTO_COMPLETE_AFTER_MINUTES
 * ago and that the doctor never marked completed. Without this they stayed
 * open forever: the patient saw "Upcoming" for a past date, couldn't book that
 * doctor again and never got the rating prompt. Run from the scheduler tick;
 * safe to run concurrently (each row is claimed atomically).
 */
export const completeOverdueConsultations = async (now = new Date()) => {
  const slotCutoff = new Date(now.getTime() - AUTO_COMPLETE_AFTER_MINUTES * 60000);
  const legacyCutoff = new Date(now.getTime() - LEGACY_AUTO_COMPLETE_DAYS * 86_400_000);
  const overdue = await Consultation.find({
    status: { $in: ['paid', 'active'] },
    $or: [
      { slotEndsAt: { $lte: slotCutoff } },
      // A slot with no recorded end: an hour after it started.
      {
        slotEndsAt: null,
        scheduledFor: { $lte: new Date(slotCutoff.getTime() - 60 * 60000) },
      },
      { scheduledFor: null, startedAt: { $lte: legacyCutoff } },
    ],
  })
    .select('_id userId doctorId')
    .limit(500)
    .lean();

  let completed = 0;
  for (const row of overdue) {
    try {
      const done = await Consultation.findOneAndUpdate(
        { _id: row._id, status: { $in: ['paid', 'active'] } },
        { $set: { status: 'completed', completedAt: now } },
        { new: true },
      );
      if (!done) continue;
      completed += 1;
      await safeEarningHook('completed', () =>
        releaseConsultationEarning(done._id, done.completedAt),
      );
      const live = {
        event: 'consultation_completed',
        consultationId: String(done._id),
        completedBy: 'system',
      };
      broadcastToRoom(`consultation_${done._id}`, live);
      notifyUserLive(done.userId, live);
      const doctor = await Doctor.findById(done.doctorId).select('userId').lean();
      if (doctor?.userId) notifyUserLive(doctor.userId, live);
    } catch (error) {
      logger.error('consultation_auto_complete_failed', {
        action: 'consultation_auto_complete_failed',
        consultationId: String(row._id),
        error: error.message,
      });
    }
  }
  return { overdue: overdue.length, completed };
};
