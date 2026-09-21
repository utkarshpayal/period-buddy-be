import Doctor from '../models/Doctor.js';
import Consultation from '../models/Consultation.js';
import ConsultationMessage from '../models/ConsultationMessage.js';
import DoctorAvailability from '../models/DoctorAvailability.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { escapeRegex, isValidObjectId } from '../utils/apiHelpers.js';
import { broadcastToRoom } from '../config/websocket.js';
import {
  createOrder,
  getOrderStatus,
  isPaymentConfigured,
  cashfreeMode,
} from '../utils/cashfreeClient.js';

const doctorGreeting = (doctor) =>
  `Hello! I am ${doctor.name}. Your confidential dashboard log has been successfully shared. How can I guide your wellness milestones today?`;

/** GET /api/consultation/doctors?search= — List all available doctors */
export const getDoctors = async (req, res, next) => {
  try {
    const { search } = req.query;
    const filter = { isAvailable: true };

    if (search) {
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { specialty: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    const doctors = await Doctor.find(filter).sort({ rating: -1 });

    logger.info('doctors_listed', {
      action: 'doctors_listed',
      userId: req.userId,
      search,
      count: doctors.length,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Doctors fetched', doctors);
  } catch (error) {
    next(error);
  }
};

const DAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** GET /api/consultation/doctors/:id/availability — Public-facing weekly
 * schedule for a doctor, grouped by day, so the app can render bookable slots. */
export const getDoctorAvailability = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }

    const doctor = await Doctor.findById(req.params.id);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    const slots = await DoctorAvailability.find({
      doctorId: doctor._id,
      isAvailable: true,
    }).sort({ dayOfWeek: 1, startTime: 1 });

    // Group into { dayOfWeek, day, slots: [{startTime,endTime,maxSlots}] }
    const byDay = new Map();
    for (const slot of slots) {
      if (!byDay.has(slot.dayOfWeek)) {
        byDay.set(slot.dayOfWeek, {
          dayOfWeek: slot.dayOfWeek,
          day: DAY_LABELS[slot.dayOfWeek],
          slots: [],
        });
      }
      byDay.get(slot.dayOfWeek).slots.push({
        startTime: slot.startTime,
        endTime: slot.endTime,
        maxSlots: slot.maxSlots,
        timezone: slot.timezone,
      });
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Availability fetched', {
      doctorId: doctor._id,
      isAvailable: doctor.isAvailable,
      days: Array.from(byDay.values()),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/consultation/order — Create a Cashfree order + a pending
 * Consultation for it. No session access is granted until /verify confirms
 * the payment actually went through. */
export const createConsultationOrder = async (req, res, next) => {
  try {
    if (!isPaymentConfigured()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Payments are not configured on the server',
      );
    }

    const { doctorId } = req.body;
    if (!isValidObjectId(doctorId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Valid doctorId is required');
    }

    const doctor = await Doctor.findOne({ _id: doctorId, isAvailable: true });
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    // Check if already booked (not cancelled)
    const existing = await Consultation.findOne({
      userId: req.userId,
      doctorId,
      status: { $in: ['paid', 'active'] },
    }).populate('doctorId');
    if (existing) {
      return sendResponse(res, HTTP_STATUS.OK, 'Consultation already booked', {
        consultation: existing,
      });
    }

    const consultation = await Consultation.create({
      userId: req.userId,
      doctorId,
      amountPaid: doctor.pricePerSession,
      currency: doctor.currency,
      status: 'pending',
      paymentStatus: 'unpaid',
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
        // Doctor.pricePerSession is already a whole-unit amount (e.g. rupees) —
        // unlike Razorpay, Cashfree's order_amount wants the whole-unit value,
        // not the currency's smallest unit.
        amount: doctor.pricePerSession,
        currency: doctor.currency,
        customer: { id: req.userId, name: user?.name, email: user?.email, phone: user?.phone },
        notes: {
          userId: String(req.userId),
          doctorId: String(doctorId),
          consultationId: String(consultation._id),
        },
      });
    } catch (error) {
      // Cashfree down/timeout after the Consultation was already persisted —
      // clean it up rather than leaving a permanently 'pending' row with no
      // cashfreeOrderId (same fix as subscriptionController.createSubscriptionOrder).
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
    await consultation.save();

    logger.info('consultation_order_created', {
      action: 'consultation_order_created',
      userId: req.userId,
      doctorId,
      consultationId: consultation._id,
      orderId: order.order_id,
      amount: doctor.pricePerSession,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Payment order created', {
      consultationId: consultation._id,
      orderId: order.order_id,
      amount: doctor.pricePerSession,
      currency: doctor.currency,
      paymentSessionId: order.payment_session_id,
      cashfreeMode: cashfreeMode(),
    });
  } catch (error) {
    logger.error('consultation_order_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** POST /api/consultation/verify — Verify a completed Cashfree checkout and,
 * only once Cashfree confirms the order was actually paid, activate the
 * Consultation session. */
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

    if (consultation.status === 'paid' || consultation.status === 'active') {
      await consultation.populate('doctorId');
      return sendResponse(res, HTTP_STATUS.OK, 'Consultation already booked', consultation);
    }

    const cfOrder = await getOrderStatus(orderId);

    // 'ACTIVE' means the order is still open — e.g. a UPI collect request
    // the user hasn't approved in their UPI app yet, which can take up to a
    // minute. That's "not paid yet", not a failure: a UPI-collect flow
    // polls this endpoint every few seconds while waiting, and marking the
    // consultation 'failed' on the first poll would kill a payment that's
    // still legitimately in flight. Only a terminal Cashfree status
    // ('EXPIRED'/'TERMINATED'/'TERMINATION_REQUESTED') is a real failure.
    if (cfOrder.order_status === 'ACTIVE') {
      return sendResponse(res, HTTP_STATUS.ACCEPTED, 'Payment still pending', { pending: true });
    }

    if (cfOrder.order_status !== 'PAID') {
      consultation.paymentStatus = 'failed';
      await consultation.save();
      logger.error('consultation_payment_verify_failed', {
        action: 'consultation_payment_verify_failed',
        userId: req.userId,
        consultationId,
        orderStatus: cfOrder.order_status,
      });
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Payment verification failed');
    }

    const doctor = await Doctor.findById(consultation.doctorId);

    // Atomically claim the pending → paid transition. Only the first of any
    // concurrent /verify calls matches (status not yet paid/active), so the
    // one-time side effects below (wallet credit, doctor counter, greeting)
    // can never run twice for the same consultation.
    const claimed = await Consultation.findOneAndUpdate(
      { _id: consultation._id, status: { $nin: ['paid', 'active', 'completed'] } },
      {
        $set: {
          status: 'paid',
          paymentStatus: 'paid',
          startedAt: new Date(),
          // Deterministic Jitsi room so patient and doctor land in the same call
          // (mirrors meetingLinkFor() in doctorController).
          meetingLink: `https://meet.jit.si/PeriodBuddy-Consult-${consultation._id}`,
          messages: [{ sender: 'doctor', text: doctorGreeting(doctor) }],
        },
      },
      { new: true },
    );

    if (!claimed) {
      // A concurrent request already booked it — return the booked state
      // without re-running side effects.
      await consultation.populate('doctorId');
      return sendResponse(res, HTTP_STATUS.OK, 'Consultation already booked', consultation);
    }

    await ConsultationMessage.create({
      consultationId: consultation._id,
      sender: 'doctor',
      text: doctorGreeting(doctor),
    });

    // Award tokens for booking
    await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 10 } });
    // Increment doctor consultation count
    await Doctor.findByIdAndUpdate(consultation.doctorId, { $inc: { totalConsultations: 1 } });

    logger.info('consultation_booked', {
      action: 'consultation_booked',
      userId: req.userId,
      doctorId: consultation.doctorId,
      doctorName: doctor.name,
      amount: consultation.amountPaid,
      orderId,
    });

    await claimed.populate('doctorId');

    return sendResponse(res, HTTP_STATUS.CREATED, 'Consultation booked successfully', claimed);
  } catch (error) {
    logger.error('consultation_verify_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** GET /api/consultation/my — Get user's consultations */
export const getMyConsultations = async (req, res, next) => {
  try {
    const consultations = await Consultation.find({ userId: req.userId })
      .populate('doctorId')
      .sort({ createdAt: -1 });

    return sendResponse(res, HTTP_STATUS.OK, 'Consultations fetched', consultations);
  } catch (error) {
    next(error);
  }
};

/** GET /api/consultation/:id/messages — Get chat messages of a consultation */
export const getMessages = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }

    const consultation = await Consultation.findOne({ _id: req.params.id, userId: req.userId });
    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Consultation not found');

    // Cap to the most recent 300 messages (newest-first, then restored to
    // chronological order) to bound the payload on long conversations.
    const messages = (
      await ConsultationMessage.find({ consultationId: consultation._id })
        .sort({ sentAt: -1 })
        .limit(300)
    ).reverse();

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
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Consultation session is not active');
    }

    // Update status to active if first user message
    if (consultation.status === 'paid') consultation.status = 'active';

    const userText = text.trim();
    consultation.messages.push({ sender: 'user', text: userText });

    await consultation.save();

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

/** PATCH /api/consultation/:id/complete — Mark a consultation as completed */
export const completeConsultation = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }

    const consultation = await Consultation.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId, status: { $in: ['paid', 'active'] } },
      { status: 'completed', completedAt: new Date() },
      { new: true, runValidators: true },
    );

    if (!consultation)
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Active consultation not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Consultation completed', consultation);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/consultation/:id/cancel — Cancel a consultation before completion */
export const cancelConsultation = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid consultation id');
    }

    const consultation = await Consultation.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId, status: { $in: ['pending', 'paid'] } },
      { status: 'cancelled', completedAt: new Date() },
      { new: true, runValidators: true },
    );

    if (!consultation)
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Cancellable consultation not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Consultation cancelled', consultation);
  } catch (error) {
    next(error);
  }
};
