import crypto from 'crypto';
import mongoose from 'mongoose';
import Doctor from '../models/Doctor.js';
import Consultation from '../models/Consultation.js';
import ConsultationMessage from '../models/ConsultationMessage.js';
import DoctorAvailability from '../models/DoctorAvailability.js';
import DoctorDateOverride from '../models/DoctorDateOverride.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { ACTIVE_ACCOUNT_FILTER } from '../utils/accountStatus.js';
import {
  BOOKING_LEAD_MINUTES,
  BOOKING_WINDOW_DAYS,
  PAYMENT_HOLD_MINUTES,
  buildSlots,
  findSlot,
} from '../utils/consultationSlots.js';
import { DEFAULT_TIME_ZONE } from '../utils/timezone.js';
import {
  cancelConsultationRecord,
  finalizePaidConsultation,
  hasSessionStarted,
  notifyUserLive,
  publicConsultation,
  publicDoctor,
} from '../utils/consultationLifecycle.js';
import { escapeRegex, isValidObjectId } from '../utils/apiHelpers.js';
import { broadcastToRoom } from '../config/websocket.js';
import { buildPrescriptionDocument } from '../utils/prescriptionDocument.js';
import { handleRefundWebhook } from '../utils/consultationRefunds.js';
import {
  createOrder,
  getOrderStatus,
  isPaymentConfigured,
  cashfreeMode,
} from '../utils/cashfreeClient.js';

/**
 * Doctors are only bookable while their login account is live and set up: a
 * suspended, deleted or still-invited clinician (no password yet) can't run
 * the session. Seeded demo doctors have no linked account and stay listed.
 */
const onlyBookableDoctors = async (doctors) => {
  const ids = [
    ...new Set(
      doctors
        .map((d) => d.userId)
        .filter(Boolean)
        .map(String),
    ),
  ];
  const ready = ids.length
    ? await User.find({
        _id: { $in: ids },
        ...ACTIVE_ACCOUNT_FILTER,
        mustSetPassword: { $ne: true },
      })
        .select('_id')
        .lean()
    : [];
  const readyIds = new Set(ready.map((u) => String(u._id)));
  return doctors.filter(
    (doctor) => !doctor.deletedAt && (!doctor.userId || readyIds.has(String(doctor.userId))),
  );
};

const findBookableDoctor = async (filter) => {
  const doctor = await Doctor.findOne(filter);
  if (!doctor) return null;
  const [bookable] = await onlyBookableDoctors([doctor]);
  return bookable || null;
};

/** A doctor's weekly ranges and date overrides, plus their booking rules as
 * buildSlots options. */
const loadSchedule = async (doctor) => {
  const [ranges, overrides] = await Promise.all([
    DoctorAvailability.find({ doctorId: doctor._id, isAvailable: true })
      .sort({ dayOfWeek: 1, startTime: 1 })
      .lean(),
    DoctorDateOverride.find({ doctorId: doctor._id }).lean(),
  ]);
  return {
    ranges,
    options: {
      overrides,
      days: doctor.bookingWindowDays || BOOKING_WINDOW_DAYS,
      leadMinutes: doctor.minNoticeMinutes ?? BOOKING_LEAD_MINUTES,
    },
  };
};

/** Start times (ms) of this doctor's slots that are taken: paid sessions, and
 * unpaid checkouts still inside their payment hold. */
const takenSlotStarts = async (doctorId, { excludeId } = {}) => {
  const holdSince = new Date(Date.now() - PAYMENT_HOLD_MINUTES * 60000);
  const rows = await Consultation.find({
    doctorId,
    ...(excludeId ? { _id: { $ne: excludeId } } : {}),
    scheduledFor: { $gte: new Date(Date.now() - 60 * 60000) },
    $or: [
      { status: { $in: ['paid', 'active', 'completed'] } },
      { status: 'pending', createdAt: { $gte: holdSince } },
    ],
  })
    .select('scheduledFor')
    .lean();
  return new Set(rows.map((r) => new Date(r.scheduledFor).getTime()));
};

/** GET /api/consultation/doctors?search= — List all available doctors */
export const getDoctors = async (req, res, next) => {
  try {
    const { search } = req.query;
    const filter = { isAvailable: true, deletedAt: null };

    if (search) {
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { specialty: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    // Rated doctors by their real average first, then everyone not yet rated.
    const doctors = (await onlyBookableDoctors(await Doctor.find(filter))).sort((a, b) => {
      const ar = a.ratingCount > 0 ? a.rating : 0;
      const br = b.ratingCount > 0 ? b.rating : 0;
      return br - ar || (b.totalConsultations || 0) - (a.totalConsultations || 0);
    });

    logger.info('doctors_listed', {
      action: 'doctors_listed',
      userId: req.userId,
      search,
      count: doctors.length,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Doctors fetched', doctors.map(publicDoctor));
  } catch (error) {
    next(error);
  }
};

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/**
 * GET /api/consultation/doctors/:id/availability — the doctor's weekly hours
 * (`days`, wall-clock in `timezone`) and the bookable `slots` for the next
 * `windowDays` (the doctor's own setting): `[{ start, end }]`, UTC ISO 8601,
 * already free of past and taken times, with date overrides applied. Clients show slots in the viewer's own time zone and book
 * one by sending its `start` as `scheduledFor`.
 */
export const getDoctorAvailability = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }

    const doctor = await findBookableDoctor({ _id: req.params.id });
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    const { ranges, options } = await loadSchedule(doctor);

    const byDay = new Map();
    for (const range of ranges) {
      if (!byDay.has(range.dayOfWeek)) {
        byDay.set(range.dayOfWeek, {
          dayOfWeek: range.dayOfWeek,
          day: DAY_LABELS[range.dayOfWeek],
          slots: [],
        });
      }
      byDay.get(range.dayOfWeek).slots.push({
        startTime: range.startTime,
        endTime: range.endTime,
        maxSlots: range.maxSlots,
        timezone: range.timezone || DEFAULT_TIME_ZONE,
      });
    }

    const slots = doctor.isAvailable
      ? buildSlots(ranges, { ...options, takenStarts: await takenSlotStarts(doctor._id) }).map(
          (slot) => ({
            start: slot.start.toISOString(),
            end: slot.end.toISOString(),
          }),
        )
      : [];

    return sendResponse(res, HTTP_STATUS.OK, 'Availability fetched', {
      doctorId: doctor._id,
      isAvailable: doctor.isAvailable,
      timezone: ranges[0]?.timezone || options.overrides[0]?.timezone || DEFAULT_TIME_ZONE,
      windowDays: options.days,
      days: Array.from(byDay.values()),
      slots,
    });
  } catch (error) {
    next(error);
  }
};

/** Re-check a pending order with Cashfree and book it if it was paid. */
const repairPendingOrder = async (consultation) => {
  if (!consultation?.cashfreeOrderId) return { outcome: 'none' };
  try {
    const cfOrder = await getOrderStatus(consultation.cashfreeOrderId);
    if (cfOrder.order_status === 'PAID') return finalizePaidConsultation(consultation);
    return { outcome: cfOrder.order_status === 'ACTIVE' ? 'open' : 'closed', cfOrder };
  } catch (error) {
    logger.warn('consultation_order_recheck_failed', {
      action: 'consultation_order_recheck_failed',
      consultationId: String(consultation._id),
      error: error.message,
    });
    return { outcome: 'unknown' };
  }
};

/** POST /api/consultation/order — Create a Cashfree order + a pending
 * Consultation for one bookable slot (`scheduledFor`, UTC ISO 8601). No
 * session access is granted until /verify confirms the payment went through. */
export const createConsultationOrder = async (req, res, next) => {
  try {
    if (!isPaymentConfigured()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Payments are not configured on the server',
      );
    }

    const { doctorId, scheduledFor } = req.body;
    if (!isValidObjectId(doctorId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Valid doctorId is required');
    }
    const when = scheduledFor ? new Date(scheduledFor) : null;
    if (!when || Number.isNaN(when.getTime())) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Pick a date and time for your consultation');
    }

    const doctor = await findBookableDoctor({ _id: doctorId, isAvailable: true });
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');
    if (doctor.userId && String(doctor.userId) === String(req.userId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, "You can't book a consultation with yourself");
    }
    const price = Number(doctor.pricePerSession);
    if (!Number.isFinite(price) || price < 1) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        "This doctor hasn't set a consultation fee yet. Please try another doctor.",
      );
    }

    // One open session per doctor: a paid/active one is opened instead.
    const existing = await Consultation.findOne({
      userId: req.userId,
      doctorId,
      status: { $in: ['paid', 'active'] },
    }).populate('doctorId');
    if (existing) {
      return sendResponse(res, HTTP_STATUS.OK, 'Consultation already booked', {
        consultation: publicConsultation(existing),
      });
    }

    // An earlier checkout for this doctor: it may have been paid (the app lost
    // the verify call), or still be open for this same slot (reuse it rather
    // than opening a second order and charging twice).
    const earlier = await Consultation.find({
      userId: req.userId,
      doctorId,
      status: 'pending',
      cashfreeOrderId: { $exists: true },
    })
      .select('+cashfreePaymentSessionId')
      .sort({ createdAt: -1 })
      .limit(3);
    for (const pending of earlier) {
      const result = await repairPendingOrder(pending);
      if (result.outcome === 'booked' || result.outcome === 'already') {
        const booked = await Consultation.findById(pending._id).populate('doctorId');
        if (booked && ['paid', 'active'].includes(booked.status)) {
          return sendResponse(res, HTTP_STATUS.OK, 'Consultation already booked', {
            consultation: publicConsultation(booked),
          });
        }
      }
      const sameSlot = pending.scheduledFor && pending.scheduledFor.getTime() === when.getTime();
      const fresh = Date.now() - pending.createdAt.getTime() < PAYMENT_HOLD_MINUTES * 60000;
      if (result.outcome === 'open' && sameSlot && fresh && pending.cashfreePaymentSessionId) {
        return sendResponse(res, HTTP_STATUS.CREATED, 'Payment order created', {
          consultationId: pending._id,
          orderId: pending.cashfreeOrderId,
          amount: pending.amountPaid,
          currency: 'INR',
          scheduledFor: pending.scheduledFor,
          paymentSessionId: pending.cashfreePaymentSessionId,
          cashfreeMode: cashfreeMode(),
        });
      }
      if (result.outcome === 'closed' || result.outcome === 'open') {
        // Abandoned: release its slot hold.
        await Consultation.updateOne(
          { _id: pending._id, status: 'pending' },
          {
            status: 'cancelled',
            cancelledBy: 'system',
            cancelReason: 'Checkout abandoned',
            completedAt: new Date(),
          },
        );
      }
    }

    const { ranges, options } = await loadSchedule(doctor);
    const slot = findSlot(ranges, when, {
      ...options,
      takenStarts: await takenSlotStarts(doctor._id),
    });
    if (!slot) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'That time is no longer available. Please pick another slot.',
      );
    }

    const consultation = await Consultation.create({
      userId: req.userId,
      doctorId,
      amountPaid: price,
      currency: 'INR',
      status: 'pending',
      paymentStatus: 'unpaid',
      scheduledFor: slot.start,
      slotEndsAt: slot.end,
      slotTimezone: slot.timezone,
    });

    const user = await User.findById(req.userId);
    // Cashfree order ids must be unique per order (not reusable like a
    // Razorpay receipt) — the consultation id alone could collide with a
    // retried booking attempt for the same consultation, so a short random
    // suffix keeps each createOrder call unique.
    const cashfreeOrderId = `consult_${consultation._id}_${Date.now().toString(36)}`;

    let order;
    try {
      order = await createOrder({
        orderId: cashfreeOrderId,
        // Whole rupees: Cashfree's order_amount is the whole-unit value.
        amount: price,
        currency: 'INR',
        customer: { id: req.userId, name: user?.name, email: user?.email, phone: user?.phone },
        notes: {
          userId: String(req.userId),
          doctorId: String(doctorId),
          consultationId: String(consultation._id),
          scheduledFor: slot.start.toISOString(),
        },
      });
    } catch (error) {
      // Cashfree down/timeout after the Consultation was already persisted —
      // clean it up rather than leaving a 'pending' row holding the slot.
      await Consultation.deleteOne({ _id: consultation._id });
      logger.error('consultation_order_create_failed', {
        action: 'consultation_order_create_failed',
        userId: req.userId,
        consultationId: consultation._id,
        error: error.message,
      });
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Could not start payment right now — please try again shortly',
      );
    }

    consultation.cashfreeOrderId = order.order_id;
    consultation.cashfreePaymentSessionId = order.payment_session_id;
    await consultation.save();

    logger.info('consultation_order_created', {
      action: 'consultation_order_created',
      userId: req.userId,
      doctorId,
      consultationId: consultation._id,
      orderId: order.order_id,
      amount: price,
      scheduledFor: slot.start.toISOString(),
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Payment order created', {
      consultationId: consultation._id,
      orderId: order.order_id,
      amount: price,
      currency: 'INR',
      scheduledFor: slot.start,
      paymentSessionId: order.payment_session_id,
      cashfreeMode: cashfreeMode(),
    });
  } catch (error) {
    logger.error('consultation_order_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** POST /api/consultation/verify — Verify a completed Cashfree checkout and,
 * only once Cashfree confirms the order was actually paid, book the session.
 * Safe to call again: the app retries it when the first call fails. */
export const verifyConsultationPayment = async (req, res, next) => {
  try {
    const { consultationId, orderId } = req.body;

    if (!isValidObjectId(consultationId) || !orderId) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Missing payment verification fields');
    }

    const consultation = await Consultation.findOne({
      _id: consultationId,
      userId: req.userId,
      cashfreeOrderId: orderId,
    });
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation order not found');

    if (['paid', 'active', 'completed'].includes(consultation.status)) {
      await consultation.populate('doctorId');
      return sendResponse(
        res,
        HTTP_STATUS.OK,
        'Consultation already booked',
        publicConsultation(consultation),
      );
    }

    const cfOrder = await getOrderStatus(orderId);

    // 'ACTIVE' means the order is still open — e.g. a UPI collect request
    // the user hasn't approved yet. That's "not paid yet", not a failure.
    if (cfOrder.order_status === 'ACTIVE') {
      return sendResponse(res, HTTP_STATUS.ACCEPTED, 'Payment still pending', { pending: true });
    }

    if (cfOrder.order_status !== 'PAID') {
      if (consultation.status === 'pending') {
        consultation.paymentStatus = 'failed';
        consultation.status = 'cancelled';
        consultation.cancelledBy = 'system';
        consultation.cancelReason = 'Payment did not complete';
        consultation.completedAt = new Date();
        await consultation.save();
      }
      logger.error('consultation_payment_verify_failed', {
        action: 'consultation_payment_verify_failed',
        userId: req.userId,
        consultationId,
        orderStatus: cfOrder.order_status,
      });
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Payment verification failed');
    }

    const { consultation: result, outcome } = await finalizePaidConsultation(consultation);
    await result.populate('doctorId');
    if (outcome === 'refund') {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        result.cancelReason
          ? `${result.cancelReason}. Your payment will be refunded.`
          : 'This booking was cancelled before your payment completed. It will be refunded.',
      );
    }
    return sendResponse(
      res,
      outcome === 'booked' ? HTTP_STATUS.CREATED : HTTP_STATUS.OK,
      outcome === 'booked' ? 'Consultation booked successfully' : 'Consultation already booked',
      publicConsultation(result),
    );
  } catch (error) {
    logger.error('consultation_verify_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/**
 * POST /api/consultation/webhook/cashfree — Cashfree payment webhook (public,
 * raw body). A consultation order paid while the app was closed or lost the
 * verify call gets booked here. The signature is checked, and the order is
 * still re-read from Cashfree before anything is booked.
 */
export const cashfreeConsultationWebhook = async (req, res) => {
  try {
    const raw = Buffer.isBuffer(req.body) ? req.body.toString('utf8') : String(req.body || '');
    const signature = req.get('x-webhook-signature');
    const timestamp = req.get('x-webhook-timestamp');
    const secret = process.env.CASHFREE_SECRET_KEY;
    if (!signature || !timestamp || !secret) return res.status(400).json({ ok: false });
    const expected = crypto
      .createHmac('sha256', secret)
      .update(timestamp + raw)
      .digest('base64');
    const valid =
      expected.length === signature.length &&
      crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    if (!valid) {
      logger.warn('consultation_webhook_bad_signature', {
        action: 'consultation_webhook_bad_signature',
      });
      return res.status(401).json({ ok: false });
    }

    const payload = JSON.parse(raw);
    // Refund updates (REFUND_STATUS_WEBHOOK) come to the same URL.
    if (payload?.data?.refund) {
      const outcome = await handleRefundWebhook(payload);
      logger.info('consultation_refund_webhook_processed', {
        action: 'consultation_refund_webhook_processed',
        orderId: payload.data.refund.order_id,
        outcome,
      });
      return res.status(200).json({ ok: true });
    }
    const orderId = payload?.data?.order?.order_id;
    if (typeof orderId !== 'string' || !orderId.startsWith('consult_')) {
      return res.status(200).json({ ok: true, ignored: true });
    }
    const consultation = await Consultation.findOne({ cashfreeOrderId: orderId });
    if (!consultation) return res.status(200).json({ ok: true, ignored: true });

    const result = await repairPendingOrder(consultation);
    logger.info('consultation_webhook_processed', {
      action: 'consultation_webhook_processed',
      consultationId: String(consultation._id),
      outcome: result.outcome,
    });
    return res.status(200).json({ ok: true });
  } catch (error) {
    logger.error('consultation_webhook_error', {
      action: 'consultation_webhook_error',
      error: error.message,
    });
    // 500 so Cashfree retries.
    return res.status(500).json({ ok: false });
  }
};

/** GET /api/consultation/my — the user's consultations (newest first). Recent
 * unpaid checkouts are re-checked with Cashfree first, so a payment whose
 * confirmation was lost still turns into a booked session. */
export const getMyConsultations = async (req, res, next) => {
  try {
    const recentPending = await Consultation.find({
      userId: req.userId,
      status: 'pending',
      cashfreeOrderId: { $exists: true },
      createdAt: { $gte: new Date(Date.now() - 2 * 60 * 60000) },
    })
      .sort({ createdAt: -1 })
      .limit(3);
    for (const pending of recentPending) await repairPendingOrder(pending);

    const consultations = await Consultation.find({ userId: req.userId })
      .populate('doctorId')
      .sort({ createdAt: -1 });

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Consultations fetched',
      consultations.map(publicConsultation),
    );
  } catch (error) {
    next(error);
  }
};

/** Doctor.rating / ratingCount from every rated session of `doctorId`. */
export const recomputeDoctorRating = async (doctorId) => {
  const [stats] = await Consultation.aggregate([
    { $match: { doctorId: new mongoose.Types.ObjectId(String(doctorId)), rating: { $gte: 1 } } },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  if (!stats) return;
  await Doctor.updateOne(
    { _id: doctorId },
    { rating: Math.round(stats.average * 10) / 10, ratingCount: stats.count },
  );
};

/**
 * POST /api/consultation/:id/rating — the patient rates a completed session,
 * once: `{ rating: 1-5, comment?: string }`. Updates the doctor's average.
 */
export const rateConsultation = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }
    const rating = Number(req.body?.rating);
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Rating must be a whole number from 1 to 5');
    }
    const comment = typeof req.body?.comment === 'string' ? req.body.comment.trim() : '';
    if (comment.length > 500) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Keep the comment under 500 characters');
    }

    const consultation = await Consultation.findOne({ _id: req.params.id, userId: req.userId });
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');
    if (consultation.status !== 'completed') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'You can rate a session once it has ended');
    }

    // Atomic "not rated yet" check, so a double tap can't rate twice.
    const rated = await Consultation.findOneAndUpdate(
      {
        _id: consultation._id,
        userId: req.userId,
        status: 'completed',
        rating: { $exists: false },
      },
      { $set: { rating, ratedAt: new Date(), ...(comment ? { feedback: comment } : {}) } },
      { new: true },
    );
    if (!rated) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'You have already rated this session');
    }

    await recomputeDoctorRating(rated.doctorId);
    logger.info('consultation_rated', {
      action: 'consultation_rated',
      userId: req.userId,
      consultationId: rated._id,
      rating,
    });

    await rated.populate('doctorId');
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Thanks for rating your session',
      publicConsultation(rated),
    );
  } catch (error) {
    next(error);
  }
};

/** GET /api/consultation/:id/messages — Get chat messages of a consultation */
/** GET /api/consultation/:id/prescription — the patient's printable
 * prescription for one of their sessions: `{ html, fileName, number }`. The
 * app turns the HTML into a PDF to download or print. */
export const getPrescription = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }
    const consultation = await Consultation.findOne({ _id: req.params.id, userId: req.userId });
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');
    const document = await buildPrescriptionDocument(consultation);
    if (!document) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'No prescription for this consultation yet');
    }
    logger.info('prescription_downloaded', {
      action: 'prescription_downloaded',
      userId: req.userId,
      consultationId: String(consultation._id),
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Prescription fetched', document);
  } catch (error) {
    next(error);
  }
};

export const getMessages = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }

    const consultation = await Consultation.findOne({
      _id: req.params.id,
      userId: req.userId,
    }).select('+messages');
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');

    // Cap to the most recent 300 messages (newest-first, then restored to
    // chronological order) to bound the payload on long conversations.
    const messages = (
      await ConsultationMessage.find({ consultationId: consultation._id })
        .sort({ sentAt: -1 })
        .limit(300)
    ).reverse();

    // Sessions from before ConsultationMessage, not yet moved by
    // scripts/migrateConsultationMessages.js.
    if (messages.length === 0 && consultation.messages && consultation.messages.length > 0) {
      return sendResponse(res, HTTP_STATUS.OK, 'Messages fetched', consultation.messages);
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Messages fetched', messages);
  } catch (error) {
    next(error);
  }
};

/** POST /api/consultation/:id/message — Send a chat message */
export const sendMessage = async (req, res, next) => {
  try {
    const { text } = req.body;

    if (!text?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message text is required');
    if (text.trim().length > 2000)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message must be 2000 characters or fewer');
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }

    const consultation = await Consultation.findOne({ _id: req.params.id, userId: req.userId });
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');
    if (consultation.status !== 'paid' && consultation.status !== 'active') {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'This consultation has ended');
    }

    // First message moves paid → active. Conditional, so it can't undo a
    // cancel or completion that landed in between.
    await Consultation.updateOne({ _id: consultation._id, status: 'paid' }, { status: 'active' });

    const userText = text.trim();
    await ConsultationMessage.create({
      consultationId: consultation._id,
      sender: 'user',
      text: userText,
    });

    logger.info('consultation_message_sent', {
      action: 'consultation_message_sent',
      userId: req.userId,
      consultationId: consultation._id,
    });

    // Both the REST response and the WS broadcast must carry the full
    // recent log (not just the message just created) — the mobile client
    // treats each of these as the authoritative list and replaces its
    // local state wholesale, so sending only the delta here made every
    // earlier message in the thread disappear until the screen refetched
    // via GET /messages.
    const responseData = (
      await ConsultationMessage.find({ consultationId: consultation._id })
        .sort({ sentAt: -1 })
        .limit(300)
    ).reverse();

    // Broadcast messages to active consultation room
    broadcastToRoom(`consultation_${consultation._id}`, {
      messages: responseData,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Message sent', responseData);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/consultation/:id/cancel — the patient cancels before the
 * session starts. A paid booking is queued for a refund. */
export const cancelConsultation = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }
    const current = await Consultation.findOne({ _id: req.params.id, userId: req.userId });
    if (!current) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');
    // Until the slot starts. A chat message or call before then moves the
    // booking to 'active', which must not take away the cancel and refund.
    if (['paid', 'active'].includes(current.status) && hasSessionStarted(current)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'This session has already started. Please talk to your doctor in the chat.',
      );
    }

    const consultation = await cancelConsultationRecord(
      { _id: current._id, userId: req.userId },
      {
        by: 'patient',
        reason: req.body?.reason,
        fromStatuses: current.status === 'pending' ? ['pending'] : ['paid', 'active'],
      },
    );
    if (!consultation) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Cancellable consultation not found');
    }
    await consultation.populate('doctorId');
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Consultation cancelled',
      publicConsultation(consultation),
    );
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/consultation/:id/call/decline — the patient declines the "your
 * doctor is in the video room" ring; the doctor's portal is told.
 */
export const declineCall = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }
    const consultation = await Consultation.findOne({ _id: req.params.id, userId: req.userId })
      .select('doctorId')
      .populate('doctorId', 'userId');
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');
    notifyUserLive(consultation.doctorId?.userId, {
      event: 'call_declined',
      consultationId: String(consultation._id),
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Call declined', { declined: true });
  } catch (error) {
    next(error);
  }
};
