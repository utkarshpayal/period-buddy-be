import crypto from 'crypto';
import Doctor from '../models/Doctor.js';
import Consultation from '../models/Consultation.js';
import ConsultationMessage from '../models/ConsultationMessage.js';
import DoctorAvailability from '../models/DoctorAvailability.js';
import Reel from '../models/Reel.js';
import User from '../models/User.js';
import CycleSettings from '../models/CycleSettings.js';
import CycleLog from '../models/CycleLog.js';
import ScreeningAssessment from '../models/ScreeningAssessment.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { isValidObjectId, escapeRegex, pickDefined } from '../utils/apiHelpers.js';
import { broadcastToRoom } from '../config/websocket.js';
import { generateToken } from '../utils/jwt.js';
import { sendMail } from '../utils/mailer.js';
import { getDoctorInviteTemplate } from '../templates/emailTemplates.js';
import { userRoleEnum } from '../enums/enums.js';
import { INVITE_EXPIRY_HOURS, buildInviteUrl } from '../utils/invite.js';
import { describeAccess, isStaffRole } from '../config/permissions.js';

/** Jitsi room per consultation — free, no keys, deterministic so both sides
 * of a booking land in the same room. */
const meetingLinkFor = (consultationId) =>
  `https://meet.jit.si/PeriodBuddy-Consult-${consultationId}`;

/** Resolve the Doctor profile backing the currently logged-in doctor User.
 * Returns null when the account has no linked profile. */
const getDoctorForUser = async (userId) => Doctor.findOne({ userId });

/** creatorId string used to scope Reels to a doctor. */
const reelCreatorId = (doctorId) => `doctor_${doctorId}`;

/* ---------------------------------------------------------------------------
 * Admin — invite & manage gynecologists
 * ------------------------------------------------------------------------- */

/** POST /api/doctor/invite (admin) — create a doctor profile + login account
 * and email a one-time set-password link. */
export const inviteDoctor = async (req, res, next) => {
  try {
    const {
      name,
      email,
      specialty,
      pricePerSession,
      currency,
      bio,
      languages,
      experience,
      hospital,
      avatarEmoji,
      education,
    } = req.body;

    if (!name?.trim() || !email?.trim() || !specialty?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'name, email, and specialty are required');
    }
    if (pricePerSession == null || Number.isNaN(Number(pricePerSession))) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid pricePerSession is required');
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'An account with this email already exists');
    }

    // Split the display name into first/last for the User record.
    const [firstName, ...rest] = name.trim().split(/\s+/);
    const lastName = rest.join(' ') || 'Doctor';

    // Placeholder password so schema validation passes; it is unusable until
    // the invitee sets their own via the invite link (mustSetPassword gate).
    const placeholderPassword = crypto.randomBytes(24).toString('hex');

    const rawToken = crypto.randomBytes(32).toString('hex');
    const inviteTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

    const user = await User.create({
      firstName,
      lastName: lastName.length >= 2 ? lastName : 'Doctor',
      email: normalizedEmail,
      password: placeholderPassword,
      role: userRoleEnum.DOCTOR,
      isEmailVerified: false,
      isActive: true,
      mustSetPassword: true,
      inviteTokenHash,
      inviteTokenExpiresAt: new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000),
    });

    const doctor = await Doctor.create({
      userId: user._id,
      email: normalizedEmail,
      name: name.trim(),
      specialty: specialty.trim(),
      pricePerSession: Number(pricePerSession),
      currency: currency || 'INR',
      bio,
      languages: Array.isArray(languages) ? languages : [],
      experience,
      hospital,
      avatarEmoji: avatarEmoji || '👩‍⚕️',
      education: Array.isArray(education) ? education : [],
      isAvailable: true,
    });

    const inviteUrl = buildInviteUrl(normalizedEmail, rawToken);

    const mailResult = await sendMail({
      to: normalizedEmail,
      subject: 'Your Nura clinician invitation',
      html: getDoctorInviteTemplate({
        name: name.trim(),
        inviteUrl,
        expiryHours: INVITE_EXPIRY_HOURS,
        specialty: specialty.trim(),
      }),
    });

    logger.info('doctor_invited', {
      action: 'doctor_invited',
      adminId: req.userId,
      doctorId: doctor._id,
      email: normalizedEmail,
      mailDelivered: mailResult?.delivered !== false,
    });

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_INVITED,
      resourceType: 'doctor',
      resourceId: doctor._id,
      metadata: { email: normalizedEmail },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Gynecologist invited', {
      doctor,
      inviteEmailDelivered: mailResult?.delivered !== false,
      // Always surfaced so the trusted admin can copy/share the link directly,
      // regardless of whether email delivery succeeded in this environment.
      inviteUrl,
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/doctor/admin/list (admin) — all doctors with account status. */
export const listDoctorsForAdmin = async (req, res, next) => {
  try {
    const { search } = req.query;
    const filter = {};
    if (search) {
      filter.$or = [
        { name: { $regex: escapeRegex(search), $options: 'i' } },
        { specialty: { $regex: escapeRegex(search), $options: 'i' } },
        { email: { $regex: escapeRegex(search), $options: 'i' } },
      ];
    }

    const doctors = await Doctor.find(filter)
      .populate('userId', 'email isActive mustSetPassword lastLogin')
      .sort({ createdAt: -1 });

    return sendResponse(res, HTTP_STATUS.OK, 'Doctors fetched', doctors);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/doctor/admin/:id (admin) — update a doctor profile / availability. */
export const updateDoctorByAdmin = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }

    const updates = pickDefined(req.body, [
      'name',
      'specialty',
      'pricePerSession',
      'currency',
      'bio',
      'languages',
      'experience',
      'hospital',
      'avatarEmoji',
      'education',
      'isAvailable',
      'rating',
    ]);

    const doctor = await Doctor.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_UPDATED,
      resourceType: 'doctor',
      resourceId: doctor._id,
      metadata: { fields: Object.keys(updates) },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Doctor updated', doctor);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/admin/:id/resend-invite (admin) — reissue the invite link. */
export const resendInvite = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }

    const doctor = await Doctor.findById(req.params.id);
    if (!doctor || !doctor.userId) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor account not found');
    }

    const user = await User.findById(doctor.userId);
    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor account not found');

    const rawToken = crypto.randomBytes(32).toString('hex');
    user.inviteTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');
    user.inviteTokenExpiresAt = new Date(Date.now() + INVITE_EXPIRY_HOURS * 60 * 60 * 1000);
    user.mustSetPassword = true;
    user.$locals.skipPasswordHash = true; // do not re-hash the stored password
    await user.save();

    const inviteUrl = buildInviteUrl(doctor.email, rawToken);

    const mailResult = await sendMail({
      to: doctor.email,
      subject: 'Your Nura clinician invitation',
      html: getDoctorInviteTemplate({
        name: doctor.name,
        inviteUrl,
        expiryHours: INVITE_EXPIRY_HOURS,
        specialty: doctor.specialty,
      }),
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Invite resent', {
      inviteEmailDelivered: mailResult?.delivered !== false,
      inviteUrl,
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/doctor/admin/:id (admin) — deactivate a doctor & their login. */
export const deactivateDoctor = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }

    const doctor = await Doctor.findByIdAndUpdate(
      req.params.id,
      { isAvailable: false },
      { new: true },
    );
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');

    if (doctor.userId) {
      await User.findByIdAndUpdate(doctor.userId, { isActive: false });
    }

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_DEACTIVATED,
      resourceType: 'doctor',
      resourceId: doctor._id,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Doctor deactivated', doctor);
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Public — set password from invite link
 * ------------------------------------------------------------------------- */

/** POST /api/doctor/set-password (public) — verify the invite token and set
 * the account password, then log the doctor in. */
export const setPasswordFromInvite = async (req, res, next) => {
  try {
    const { email, token, password } = req.body;

    if (!email?.trim() || !token?.trim() || !password) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'email, token, and password are required');
    }
    if (String(password).length < 8) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Password must be at least 8 characters');
    }

    const user = await User.findOne({ email: email.trim().toLowerCase() }).select(
      '+password +inviteTokenHash +inviteTokenExpiresAt',
    );

    if (!user || !user.inviteTokenHash) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This invite link is no longer valid');
    }
    if (!user.inviteTokenExpiresAt || user.inviteTokenExpiresAt.getTime() < Date.now()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This invite link has expired');
    }

    const incomingHash = crypto.createHash('sha256').update(token.trim()).digest('hex');
    if (incomingHash !== user.inviteTokenHash) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This invite link is invalid');
    }

    user.password = password; // hashed by the pre-save hook
    user.inviteTokenHash = undefined;
    user.inviteTokenExpiresAt = undefined;
    user.mustSetPassword = false;
    user.isEmailVerified = true;
    user.isActive = true;
    user.lastLogin = new Date();
    await user.save();

    const authToken = generateToken({ userId: user._id, email: user.email, role: user.role });

    // This link also onboards Admin Workspace staff (staffController), so
    // carry their access the same way the login response does.
    const userData = user.toJSON();
    if (isStaffRole(user.role)) userData.access = describeAccess(user.role);

    return sendResponse(res, HTTP_STATUS.OK, 'Password set successfully', userData, authToken);
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — profile
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/me — the logged-in doctor's profile. */
export const getMyProfile = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Profile fetched', doctor);
  } catch (error) {
    next(error);
  }
};

/** PUT /api/doctor/me — update own profile. */
export const updateMyProfile = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const updates = pickDefined(req.body, [
      'name',
      'specialty',
      'pricePerSession',
      'currency',
      'bio',
      'languages',
      'experience',
      'hospital',
      'avatarEmoji',
      'education',
      'isAvailable',
    ]);

    Object.assign(doctor, updates);
    await doctor.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Profile updated', doctor);
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — dashboard
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/dashboard — headline stats for the clinician home. */
export const getDashboard = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const [statusCounts, paid, recent] = await Promise.all([
      Consultation.aggregate([
        { $match: { doctorId: doctor._id } },
        { $group: { _id: '$status', count: { $sum: 1 } } },
      ]),
      Consultation.aggregate([
        { $match: { doctorId: doctor._id, paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amountPaid' }, count: { $sum: 1 } } },
      ]),
      Consultation.find({ doctorId: doctor._id })
        .populate('userId', 'firstName lastName email profilePicture')
        .sort({ createdAt: -1 })
        .limit(6),
    ]);

    const counts = statusCounts.reduce((acc, row) => ({ ...acc, [row._id]: row.count }), {});
    const totalBookings = Object.values(counts).reduce((sum, n) => sum + n, 0);

    return sendResponse(res, HTTP_STATUS.OK, 'Dashboard fetched', {
      doctor: {
        name: doctor.name,
        specialty: doctor.specialty,
        avatarEmoji: doctor.avatarEmoji,
        rating: doctor.rating,
        isAvailable: doctor.isAvailable,
      },
      stats: {
        totalBookings,
        active: counts.active || 0,
        paid: counts.paid || 0,
        pending: counts.pending || 0,
        completed: counts.completed || 0,
        cancelled: counts.cancelled || 0,
        totalEarnings: paid[0]?.total || 0,
        paidSessions: paid[0]?.count || 0,
        currency: doctor.currency,
      },
      recentBookings: recent,
    });
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — bookings / consultations
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/consultations?status= — the doctor's bookings. */
export const getConsultations = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const filter = { doctorId: doctor._id };
    const { status } = req.query;
    if (status) {
      // Patients never pay for a booking that stays 'pending', so hide those
      // from the doctor's default views unless explicitly requested.
      filter.status = status;
    } else {
      filter.status = { $ne: 'pending' };
    }

    const consultations = await Consultation.find(filter)
      .populate('userId', 'firstName lastName email profilePicture')
      .sort({ createdAt: -1 });

    return sendResponse(res, HTTP_STATUS.OK, 'Consultations fetched', consultations);
  } catch (error) {
    next(error);
  }
};

/** Load a consultation and confirm it belongs to the logged-in doctor. */
const loadOwnedConsultation = async (userId, consultationId) => {
  const doctor = await getDoctorForUser(userId);
  if (!doctor) return { error: 'Doctor profile not found', code: HTTP_STATUS.NOT_FOUND };
  if (!isValidObjectId(consultationId)) {
    return { error: 'Invalid consultation id', code: HTTP_STATUS.BAD_REQUEST };
  }
  const consultation = await Consultation.findOne({
    _id: consultationId,
    doctorId: doctor._id,
  });
  if (!consultation) return { error: 'Consultation not found', code: HTTP_STATUS.NOT_FOUND };
  return { doctor, consultation };
};

/** Statuses at which a doctor is "connected" to a patient and may view their
 * health data. A pending/cancelled booking grants no clinical access. */
const CONNECTED_STATUSES = ['paid', 'active', 'completed'];

/** Whole years between a date of birth and now; null when DOB is unknown. */
const ageFromDob = (dob) => {
  if (!dob) return null;
  const birth = new Date(dob);
  if (Number.isNaN(birth.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age -= 1;
  return age >= 0 ? age : null;
};

/** GET /api/doctor/consultations/:id/patient — the connected patient's health
 * overview (profile, cycle settings, recent logs, screenings). Only exposed
 * for consultations the doctor owns that reached a paid/active/completed state,
 * so a doctor can only ever see the data of a genuinely connected patient. */
export const getConsultationPatient = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    if (!CONNECTED_STATUSES.includes(consultation.status)) {
      return sendError(
        res,
        HTTP_STATUS.FORBIDDEN,
        'Patient records are available only after the booking is confirmed (paid or active).',
      );
    }

    const patientId = consultation.userId;
    const [user, cycleSettings, recentLogs, screenings] = await Promise.all([
      User.findById(patientId).select(
        'firstName lastName email profilePicture dateOfBirth gender country language',
      ),
      CycleSettings.findOne({ userId: patientId }).select(
        'lastPeriodStartDate cycleLength periodLength pregnancyMode trackingGoal',
      ),
      CycleLog.find({ userId: patientId })
        .select('date dateKey flow mood energy symptoms phase cycleDay note')
        .sort({ date: -1 })
        .limit(14),
      ScreeningAssessment.find({ userId: patientId })
        .select('condition score riskLevel summary doctorDiscussionSummary createdAt')
        .sort({ createdAt: -1 })
        .limit(8),
    ]);

    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Patient not found');

    // Keep only the most recent screening per condition.
    const latestByCondition = {};
    for (const s of screenings) {
      if (!latestByCondition[s.condition]) latestByCondition[s.condition] = s;
    }

    const overview = {
      profile: {
        id: user._id,
        name: [user.firstName, user.lastName].filter(Boolean).join(' ') || user.email,
        email: user.email,
        profilePicture: user.profilePicture,
        gender: user.gender,
        age: ageFromDob(user.dateOfBirth),
        dateOfBirth: user.dateOfBirth,
        country: user.country,
      },
      cycle: cycleSettings
        ? {
            lastPeriodStartDate: cycleSettings.lastPeriodStartDate,
            cycleLength: cycleSettings.cycleLength,
            periodLength: cycleSettings.periodLength,
            pregnancyMode: cycleSettings.pregnancyMode,
            trackingGoal: cycleSettings.trackingGoal,
          }
        : null,
      recentLogs,
      screenings: Object.values(latestByCondition),
      consultation: {
        id: consultation._id,
        status: consultation.status,
        prescription: consultation.prescription,
        startedAt: consultation.startedAt,
      },
    };

    return sendResponse(res, HTTP_STATUS.OK, 'Patient overview fetched', overview);
  } catch (error) {
    next(error);
  }
};

/** GET /api/doctor/consultations/:id/messages */
export const getConsultationMessages = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    const messages = (
      await ConsultationMessage.find({ consultationId: consultation._id })
        .sort({ sentAt: -1 })
        .limit(300)
    ).reverse();

    // Mark inbound (patient) messages as read now that the doctor is viewing.
    await ConsultationMessage.updateMany(
      { consultationId: consultation._id, sender: 'user', readAt: null },
      { readAt: new Date() },
    );

    return sendResponse(res, HTTP_STATUS.OK, 'Messages fetched', messages);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/consultations/:id/message — doctor replies to a patient. */
export const sendConsultationMessage = async (req, res, next) => {
  try {
    const { text, attachmentUrl } = req.body;
    if (!text?.trim()) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message text is required');
    if (text.trim().length > 3000) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Message must be 3000 characters or fewer');
    }

    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    if (!['paid', 'active'].includes(consultation.status)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'This consultation session is not active');
    }
    if (consultation.status === 'paid') consultation.status = 'active';
    await consultation.save();

    const message = await ConsultationMessage.create({
      consultationId: consultation._id,
      sender: 'doctor',
      text: text.trim(),
      attachmentUrl: attachmentUrl || undefined,
    });

    // Broadcast the full recent log, not just this one message — the mobile
    // client replaces its local message list wholesale with whatever a "message"
    // WS event carries, so sending only the delta made every earlier message in
    // the thread disappear on the patient's side until they refreshed the screen.
    const recentMessages = (
      await ConsultationMessage.find({ consultationId: consultation._id })
        .sort({ sentAt: -1 })
        .limit(300)
    ).reverse();

    broadcastToRoom(`consultation_${consultation._id}`, { messages: recentMessages });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Message sent', message);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/consultations/:id/call — start (or resume) a video call. */
export const startVideoCall = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    if (!['paid', 'active'].includes(consultation.status)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'This consultation session is not active');
    }

    if (!consultation.meetingLink) {
      consultation.meetingLink = meetingLinkFor(consultation._id);
    }
    if (consultation.status === 'paid') consultation.status = 'active';
    await consultation.save();

    // Let the patient's session know a call is live and where to join.
    broadcastToRoom(`consultation_${consultation._id}`, {
      event: 'call_started',
      meetingLink: consultation.meetingLink,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Video call ready', {
      meetingLink: consultation.meetingLink,
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/doctor/consultations/:id/prescription */
export const setPrescription = async (req, res, next) => {
  try {
    const { prescription } = req.body;
    if (!prescription?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Prescription text is required');
    }

    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    // Only during a live session — once completed/cancelled, the record is
    // closed and shouldn't be editable from the dashboard, disabled button
    // or not (the UI-only guard was bypassable via a direct API call).
    if (!['paid', 'active'].includes(consultation.status)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This consultation session is not active');
    }

    consultation.prescription = prescription.trim();
    await consultation.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Prescription saved', consultation);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/doctor/consultations/:id/complete */
export const completeConsultation = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    if (!['paid', 'active'].includes(consultation.status)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Only an active session can be completed');
    }

    consultation.status = 'completed';
    consultation.completedAt = new Date();
    await consultation.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Consultation completed', consultation);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/doctor/consultations/:id/cancel */
export const cancelConsultation = async (req, res, next) => {
  try {
    const { error, code, consultation } = await loadOwnedConsultation(req.userId, req.params.id);
    if (error) return sendError(res, code, error);

    if (!['pending', 'paid'].includes(consultation.status)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This consultation cannot be cancelled');
    }

    consultation.status = 'cancelled';
    consultation.completedAt = new Date();
    await consultation.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Consultation cancelled', consultation);
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — payments / earnings
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/payments — paid sessions plus totals. */
export const getPayments = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const payments = await Consultation.find({
      doctorId: doctor._id,
      paymentStatus: 'paid',
    })
      .populate('userId', 'firstName lastName email')
      .sort({ startedAt: -1, createdAt: -1 });

    const total = payments.reduce((sum, p) => sum + (p.amountPaid || 0), 0);

    return sendResponse(res, HTTP_STATUS.OK, 'Payments fetched', {
      total,
      count: payments.length,
      currency: doctor.currency,
      payments,
    });
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — availability
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/availability */
export const getAvailability = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const slots = await DoctorAvailability.find({ doctorId: doctor._id }).sort({
      dayOfWeek: 1,
      startTime: 1,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Availability fetched', slots);
  } catch (error) {
    next(error);
  }
};

/** PUT /api/doctor/availability — replace the doctor's weekly slots. */
export const setAvailability = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const { slots } = req.body;
    if (!Array.isArray(slots)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'slots must be an array');
    }

    const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;
    for (const slot of slots) {
      if (
        typeof slot.dayOfWeek !== 'number' ||
        slot.dayOfWeek < 0 ||
        slot.dayOfWeek > 6 ||
        !timeRe.test(slot.startTime || '') ||
        !timeRe.test(slot.endTime || '')
      ) {
        return sendError(
          res,
          HTTP_STATUS.BAD_REQUEST,
          'Each slot needs dayOfWeek (0-6) and HH:MM startTime/endTime',
        );
      }
    }

    await DoctorAvailability.deleteMany({ doctorId: doctor._id });
    const created = slots.length
      ? await DoctorAvailability.insertMany(
          slots.map((s) => ({
            doctorId: doctor._id,
            dayOfWeek: s.dayOfWeek,
            startTime: s.startTime,
            endTime: s.endTime,
            timezone: s.timezone || 'UTC',
            isAvailable: s.isAvailable !== false,
            maxSlots: s.maxSlots || 4,
          })),
        )
      : [];

    return sendResponse(res, HTTP_STATUS.OK, 'Availability updated', created);
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------------------------------------------------
 * Doctor — reels / content
 * ------------------------------------------------------------------------- */

/** GET /api/doctor/reels — reels published by this doctor. */
export const getMyReels = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const reels = await Reel.find({ creatorId: reelCreatorId(doctor._id) }).sort({
      publishedAt: -1,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Reels fetched', reels);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/reels — publish a new educational reel. */
export const createReel = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');

    const { title, thumbnailUrl, directMp4Url, category, duration, pollQuestion, pollOptions } =
      req.body;

    if (!title?.trim() || !thumbnailUrl?.trim() || !directMp4Url?.trim()) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'title, thumbnailUrl, and directMp4Url are required',
      );
    }

    const options = Array.isArray(pollOptions)
      ? pollOptions
          .map((option, index) => ({
            optionId: option.optionId || `option_${index + 1}`,
            topic: option.topic,
            votes: Number(option.votes || 0),
          }))
          .filter((option) => option.topic)
      : [];

    const reel = await Reel.create({
      title: title.trim(),
      creatorId: reelCreatorId(doctor._id),
      creatorName: doctor.name,
      creatorAvatar: doctor.avatarEmoji,
      duration: duration || '0:30',
      category: category || doctor.specialty || 'Wellness',
      verified: true,
      thumbnailUrl: thumbnailUrl.trim(),
      directMp4Url: directMp4Url.trim(),
      pollQuestion,
      pollOptions: options,
      publishedAt: new Date(),
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Reel published', reel);
  } catch (error) {
    next(error);
  }
};

/** PUT /api/doctor/reels/:id — update one of the doctor's reels. */
export const updateReel = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    const updates = pickDefined(req.body, [
      'title',
      'duration',
      'category',
      'thumbnailUrl',
      'directMp4Url',
      'pollQuestion',
      'pollOptions',
      'isActive',
    ]);

    const reel = await Reel.findOneAndUpdate(
      { _id: req.params.id, creatorId: reelCreatorId(doctor._id) },
      updates,
      { new: true, runValidators: true },
    );
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Reel updated', reel);
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/doctor/reels/:id — soft-delete one of the doctor's reels. */
export const deleteReel = async (req, res, next) => {
  try {
    const doctor = await getDoctorForUser(req.userId);
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid reel id');
    }

    const reel = await Reel.findOneAndUpdate(
      { _id: req.params.id, creatorId: reelCreatorId(doctor._id) },
      { isActive: false },
      { new: true },
    );
    if (!reel) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Reel not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Reel deleted');
  } catch (error) {
    next(error);
  }
};
