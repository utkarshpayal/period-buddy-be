import Doctor from '../models/Doctor.js';
import Consultation from '../models/Consultation.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { escapeRegex, isValidObjectId } from '../utils/apiHelpers.js';

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

    logger.info('doctors_listed', { action: 'doctors_listed', userId: req.userId, search, count: doctors.length });

    return sendResponse(res, HTTP_STATUS.OK, 'Doctors fetched', doctors);
  } catch (error) {
    next(error);
  }
};

/** POST /api/consultation/book — Book a consultation (create + process payment) */
export const bookConsultation = async (req, res, next) => {
  try {
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
    });
    if (existing) {
      return sendResponse(res, HTTP_STATUS.OK, 'Consultation already booked', existing);
    }

    const consultation = await Consultation.create({
      userId: req.userId,
      doctorId,
      amountPaid: doctor.pricePerSession,
      currency: doctor.currency,
      status: 'paid',
      startedAt: new Date(),
      messages: [
        {
          sender: 'doctor',
          text: `Hello! I am ${doctor.name}. Your confidential dashboard log has been successfully shared. How can I guide your wellness milestones today?`,
        },
      ],
    });

    // Award tokens for booking
    await User.findByIdAndUpdate(req.userId, { $inc: { tokenEarned: 10 } });
    // Increment doctor consultation count
    await Doctor.findByIdAndUpdate(doctorId, { $inc: { totalConsultations: 1 } });

    logger.info('consultation_booked', {
      action: 'consultation_booked',
      userId: req.userId,
      doctorId,
      doctorName: doctor.name,
      amount: doctor.pricePerSession,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Consultation booked successfully', consultation);
  } catch (error) {
    logger.error('consultation_book_error', { userId: req.userId, error: error.message });
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

    return sendResponse(res, HTTP_STATUS.OK, 'Messages fetched', consultation.messages);
  } catch (error) {
    next(error);
  }
};

/** POST /api/consultation/:id/message — Send a chat message */
export const sendMessage = async (req, res, next) => {
  try {
    const { text } = req.body;

    if (!text?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message text is required');
    if (text.trim().length > 2000) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message must be 2000 characters or fewer');
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

    consultation.messages.push({ sender: 'user', text: text.trim() });

    // Simulate doctor's auto-reply
    const doctorReply = 'Understood. Our logging engine is checking your cycle history trend structures to fine-tune diagnostic assessments. Please provide any related physical updates.';
    consultation.messages.push({ sender: 'doctor', text: doctorReply });

    await consultation.save();

    logger.info('consultation_message_sent', {
      action: 'consultation_message_sent',
      userId: req.userId,
      consultationId: consultation._id,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Message sent', consultation.messages.slice(-2));
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
      { new: true, runValidators: true }
    );

    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Active consultation not found');

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
      { new: true, runValidators: true }
    );

    if (!consultation) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Cancellable consultation not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Consultation cancelled', consultation);
  } catch (error) {
    next(error);
  }
};
