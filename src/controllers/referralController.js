import ClinicalPayoutSettings from '../models/ClinicalPayoutSettings.js';
import Doctor from '../models/Doctor.js';
import DoctorEarning from '../models/DoctorEarning.js';
import DoctorReferral from '../models/DoctorReferral.js';
import ReferralCredit from '../models/ReferralCredit.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
} from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import logger from '../utils/logger.js';
import { fromMinor } from '../utils/payoutMath.js';
import {
  ReferralError,
  describeCredit,
  describeReferral,
  describeReferralForReferrer,
  describeReferralSettings,
  getReferralSettings,
  grantCredit,
  notifyReferrer,
  notifyReviewers,
  revokeCredit,
} from '../utils/referrals.js';
import {
  OPEN_REFERRAL_STATUSES,
  REFERRAL_STATUSES,
  canMoveReferral,
  intInRange,
  statusFields,
  summarizeCredits,
  validateReferralInput,
} from '../utils/referralMath.js';
import { DoctorInviteError, createDoctorInvite } from './doctorController.js';

/**
 * Gynac referral program (docs/gynac-referrals-plan.md in the Admin
 * Workspace repo):
 * - /api/doctor/referrals/*  — the gynac's own referrals and free sessions;
 * - /api/admin/referrals/*   — Clinical Admin review, credits and settings
 *   (referrals.read / referrals.manage). Every admin write is audited.
 */

const handle = (res, next, error) => {
  if (error instanceof ReferralError) {
    return res.status(error.status).json({
      success: false,
      statusCode: error.status,
      message: error.message,
      code: error.code,
    });
  }
  return next(error);
};

const cleanReason = (value, max = 300) =>
  String(value ?? '')
    .trim()
    .slice(0, max);

const isDuplicateKey = (error) => error?.code === 11000;

const ALREADY_REFERRED = 'This colleague has already been referred to Nura';

/** What a gynac is told when an email can't be referred. One message for
 * every reason, so the portal never reveals whether someone (perhaps a
 * patient) has a Nura account. */
const CANNOT_REFER =
  'This colleague can’t be referred. They may already be on Nura or referred by someone else.';

/**
 * Refuse an email that can't be referred (already on Nura, or referred).
 * `generic` (the gynac portal) hides which of the two it is.
 */
const assertReferable = async (email, { referrer, generic = false } = {}) => {
  if (referrer && referrer.email === email) {
    throw new ReferralError('You cannot refer yourself', 400, 'SELF_REFERRAL');
  }
  const [user, live] = await Promise.all([
    User.findOne({ email }).select('_id').lean(),
    DoctorReferral.exists({ referredEmail: email, isLive: true }),
  ]);
  if (generic && (user || live)) throw new ReferralError(CANNOT_REFER, 409, 'CANNOT_REFER');
  if (live) throw new ReferralError(ALREADY_REFERRED, 409, 'ALREADY_REFERRED');
  if (user)
    throw new ReferralError('This email already has a Nura account', 409, 'ALREADY_ON_NURA');
};

/* ======================================================================
 * Doctor portal
 * ==================================================================== */

const loadDoctor = async (req, res) => {
  const doctor = await Doctor.findOne({ userId: req.userId }).select(
    '_id name email userId pricePerSession',
  );
  if (!doctor) sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor profile not found');
  return doctor;
};

/** GET /api/doctor/referrals — my referrals, free sessions and the program rules. */
export const getMyReferrals = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    const [settings, referrals, credits] = await Promise.all([
      getReferralSettings(),
      DoctorReferral.find({ referrerDoctorId: doctor._id })
        .sort({ createdAt: -1 })
        .limit(200)
        .lean(),
      ReferralCredit.find({ doctorId: doctor._id })
        .populate('referralId', 'referredName')
        .sort({ createdAt: -1 })
        .lean(),
    ]);
    const totals = summarizeCredits(credits);
    const program = describeReferralSettings(settings);
    const open = referrals.filter((r) => OPEN_REFERRAL_STATUSES.includes(r.status)).length;
    return sendResponse(res, HTTP_STATUS.OK, 'Referrals fetched', {
      program: {
        enabled: program.enabled,
        rewardSessions: program.rewardSessions,
        creditExpiryDays: program.creditExpiryDays,
        maxOpen: program.maxOpenPerDoctor,
        openCount: open,
      },
      summary: {
        freeSessionsRemaining: totals.remaining,
        freeSessionsUsed: totals.used,
        freeSessionsGranted: totals.granted,
        commissionSaved: fromMinor(totals.commissionSavedMinor),
        referred: referrals.length,
        joined: referrals.filter((r) => r.status === 'onboarded').length,
      },
      referrals: referrals.map(describeReferralForReferrer),
      credits: credits.map((c) => {
        const { doctor: _omit, ...rest } = describeCredit(c);
        return rest;
      }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/referrals — refer a colleague { name, email, phone?, note? }. */
export const createMyReferral = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    const settings = await getReferralSettings();
    if (settings.referralProgramEnabled === false) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'Referrals are paused right now');
    }
    const { error, value } = validateReferralInput(req.body);
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);

    const open = await DoctorReferral.countDocuments({
      referrerDoctorId: doctor._id,
      status: { $in: OPEN_REFERRAL_STATUSES },
    });
    const cap = settings.referralMaxOpenPerDoctor ?? 10;
    if (open >= cap) {
      return sendError(
        res,
        HTTP_STATUS.TOO_MANY_REQUESTS,
        `You can have up to ${cap} referrals waiting to join at a time`,
      );
    }
    await assertReferable(value.email, { referrer: doctor, generic: true });

    // Hold the email first (the unique live index), then send the invite.
    let referral;
    try {
      referral = await DoctorReferral.create({
        referrerDoctorId: doctor._id,
        referredName: value.name,
        referredEmail: value.email,
        referredPhone: value.phone,
        note: value.note,
        source: 'portal',
        // The reward promised now is the one given, whatever the setting later.
        rewardSessions: settings.referralRewardSessions ?? 5,
        ...statusFields('submitted'),
      });
    } catch (e) {
      if (isDuplicateKey(e)) return sendError(res, HTTP_STATUS.CONFLICT, CANNOT_REFER);
      throw e;
    }

    // No admin review: the colleague is invited straight away. Their profile
    // starts at the referrer's fee with bookings paused, so nobody can book
    // them until they've joined and set up their practice.
    let invite;
    try {
      invite = await createDoctorInvite(
        {
          name: value.name,
          email: value.email,
          specialty: value.specialty || 'Gynecologist',
          pricePerSession: doctor.pricePerSession,
        },
        { referredBy: doctor.name, paused: true },
      );
    } catch (e) {
      // Free the email so the gynac can fix it and try again.
      await DoctorReferral.deleteOne({ _id: referral._id });
      if (e instanceof DoctorInviteError) {
        return sendError(
          res,
          e.status,
          e.status === HTTP_STATUS.CONFLICT ? CANNOT_REFER : e.message,
        );
      }
      throw e;
    }
    referral = await DoctorReferral.findByIdAndUpdate(
      referral._id,
      {
        $set: {
          ...statusFields('invited'),
          referredDoctorId: invite.doctor._id,
          invitedAt: new Date(),
        },
      },
      { new: true },
    );

    logger.info('referral_submitted', {
      action: 'referral_submitted',
      referralId: String(referral._id),
      referrerDoctorId: String(doctor._id),
      doctorId: String(invite.doctor._id),
      mailDelivered: invite.inviteEmailDelivered,
    });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_SUBMITTED,
      resourceType: 'doctor_referral',
      resourceId: referral._id,
      metadata: {
        referrerDoctorId: String(doctor._id),
        doctorId: String(invite.doctor._id),
        invited: true,
      },
    });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_INVITED,
      resourceType: 'doctor',
      resourceId: invite.doctor._id,
      metadata: { email: value.email, referralId: String(referral._id), via: 'referral' },
    });
    // Emails go out in the background: the gynac shouldn't wait on them.
    const forEmail = {
      ...referral.toObject(),
      rewardSessions: settings.referralRewardSessions ?? 5,
    };
    notifyReferrer(forEmail, 'sent');
    notifyReviewers(forEmail, doctor.name);
    return sendResponse(res, HTTP_STATUS.CREATED, `Invite sent to ${value.email}`, {
      ...describeReferralForReferrer(referral.toObject()),
      inviteEmailDelivered: invite.inviteEmailDelivered,
    });
  } catch (error) {
    handle(res, next, error);
  }
};

/** DELETE /api/doctor/referrals/:id — withdraw a referral still in review. */
export const withdrawMyReferral = async (req, res, next) => {
  try {
    const doctor = await loadDoctor(req, res);
    if (!doctor) return;
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid referral id');
    }
    const referral = await DoctorReferral.findOneAndUpdate(
      { _id: req.params.id, referrerDoctorId: doctor._id, status: 'submitted' },
      { $set: statusFields('withdrawn') },
      { new: true },
    ).lean();
    if (!referral) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'Only a referral still in review can be withdrawn',
      );
    }
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_WITHDRAWN,
      resourceType: 'doctor_referral',
      resourceId: referral._id,
    });
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Referral withdrawn',
      describeReferralForReferrer(referral),
    );
  } catch (error) {
    next(error);
  }
};

/* ======================================================================
 * Admin
 * ==================================================================== */

const populateReferral = (query) =>
  query
    .populate('referrerDoctorId', 'name email avatarUrl')
    .populate('referredDoctorId', 'name email avatarUrl');

const loadReferral = async (id) => {
  if (!isValidObjectId(id)) throw new ReferralError('Invalid referral id', 400, 'BAD_ID');
  const referral = await DoctorReferral.findById(id);
  if (!referral) throw new ReferralError('Referral not found', 404, 'NOT_FOUND');
  return referral;
};

/** Compare-and-set a status move; throws when someone else moved it first. */
const moveReferral = async (referral, to, $set = {}) => {
  if (!canMoveReferral(referral.status, to)) {
    throw new ReferralError(`A ${referral.status} referral cannot be ${to}`, 409, 'BAD_TRANSITION');
  }
  const updated = await DoctorReferral.findOneAndUpdate(
    { _id: referral._id, status: referral.status },
    { $set: { ...statusFields(to), ...$set } },
    { new: true },
  );
  if (!updated)
    throw new ReferralError('This referral just changed — refresh and try again', 409, 'STALE');
  return updated;
};

const respondReferral = async (res, status, message, id) => {
  const fresh = await populateReferral(DoctorReferral.findById(id)).lean();
  return sendResponse(res, status, message, describeReferral(fresh));
};

/** GET /api/admin/referrals?status=&referrerId=&search=&page=&limit= */
export const listReferrals = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.status && REFERRAL_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }
    if (req.query.referrerId) {
      if (!isValidObjectId(req.query.referrerId)) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid referrer id');
      }
      filter.referrerDoctorId = req.query.referrerId;
    }
    if (req.query.search) {
      const rx = { $regex: escapeRegex(String(req.query.search).trim()), $options: 'i' };
      const referrers = await Doctor.find({ name: rx }).select('_id').limit(50).lean();
      filter.$or = [
        { referredName: rx },
        { referredEmail: rx },
        { referrerDoctorId: { $in: referrers.map((d) => d._id) } },
      ];
    }
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const [rows, total] = await Promise.all([
      populateReferral(DoctorReferral.find(filter))
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      DoctorReferral.countDocuments(filter),
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Referrals fetched', {
      referrals: rows.map(describeReferral),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/admin/referrals/summary — program KPIs. */
export const getReferralSummary = async (req, res, next) => {
  try {
    const now = new Date();
    const [byStatus, creditTotals, savedTotals, settings, delivered] = await Promise.all([
      DoctorReferral.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      ReferralCredit.aggregate([
        {
          $group: {
            _id: null,
            granted: { $sum: '$sessionsGranted' },
            used: { $sum: '$sessionsUsed' },
            revoked: { $sum: { $ifNull: ['$sessionsRevoked', 0] } },
            // Still usable: active, not lapsed, room left.
            remaining: {
              $sum: {
                $cond: [
                  {
                    $and: [
                      { $eq: ['$status', 'active'] },
                      {
                        $or: [
                          { $eq: [{ $ifNull: ['$expiresAt', null] }, null] },
                          { $gt: ['$expiresAt', now] },
                        ],
                      },
                    ],
                  },
                  { $max: [0, { $subtract: ['$sessionsGranted', '$sessionsUsed'] }] },
                  0,
                ],
              },
            },
          },
        },
      ]),
      ReferralCredit.aggregate([
        { $unwind: '$usages' },
        {
          $group: {
            _id: null,
            savedMinor: { $sum: { $ifNull: ['$usages.commissionSavedMinor', 0] } },
          },
        },
      ]),
      getReferralSettings(),
      // Free sessions that actually took place (not just booked).
      DoctorEarning.countDocuments({
        type: 'consultation',
        commissionSource: 'referral',
        status: 'active',
        completedAt: { $ne: null },
      }),
    ]);
    const counts = Object.fromEntries(REFERRAL_STATUSES.map((s) => [s, 0]));
    for (const row of byStatus) counts[row._id] = row.count;
    const t = creditTotals[0] || { granted: 0, used: 0, revoked: 0, remaining: 0 };
    return sendResponse(res, HTTP_STATUS.OK, 'Referral summary', {
      referrals: counts,
      sessions: {
        granted: t.granted,
        used: t.used,
        remaining: t.remaining,
        revoked: t.revoked,
        freeSessionsDelivered: delivered,
      },
      commissionForgone: fromMinor(savedTotals[0]?.savedMinor || 0),
      settings: describeReferralSettings(settings),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/admin/referrals — record a referral made offline:
 * { referrerDoctorId, doctorId } attaches a referrer to a gynac who was
 * invited but hasn't joined yet; { referrerDoctorId, name, email, ... }
 * logs a lead to review like a portal one.
 */
export const createReferralByAdmin = async (req, res, next) => {
  try {
    const { referrerDoctorId, doctorId } = req.body || {};
    if (!isValidObjectId(referrerDoctorId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Choose the referring gynac');
    }
    const referrer = await Doctor.findOne({ _id: referrerDoctorId, deletedAt: null })
      .select('_id name email')
      .lean();
    if (!referrer) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Referring gynac not found');

    let referral;
    if (doctorId) {
      if (!isValidObjectId(doctorId))
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid gynac');
      const doctor = await Doctor.findOne({ _id: doctorId, deletedAt: null })
        .populate('userId', 'mustSetPassword isActive')
        .lean();
      if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Gynac not found');
      if (String(doctor._id) === String(referrer._id)) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A gynac cannot refer themselves');
      }
      if (!doctor.userId?.mustSetPassword || doctor.userId?.isActive === false) {
        return sendError(
          res,
          HTTP_STATUS.CONFLICT,
          'Only a gynac who is invited but has not joined yet can be credited to a referrer',
        );
      }
      const live = await DoctorReferral.findOne({
        $or: [{ referredEmail: doctor.email }, { referredDoctorId: doctor._id }],
        isLive: true,
      }).lean();
      if (live) {
        return sendError(
          res,
          HTTP_STATUS.CONFLICT,
          'This gynac already has a referrer — reassign it instead',
        );
      }
      try {
        referral = await DoctorReferral.create({
          referrerDoctorId: referrer._id,
          referredName: doctor.name,
          referredEmail: doctor.email,
          referredDoctorId: doctor._id,
          source: 'admin',
          createdBy: req.userId,
          reviewedBy: req.userId,
          reviewedAt: new Date(),
          invitedAt: new Date(),
          note: cleanReason(req.body.note, 500) || undefined,
          ...statusFields('invited'),
        });
      } catch (e) {
        if (isDuplicateKey(e)) return sendError(res, HTTP_STATUS.CONFLICT, ALREADY_REFERRED);
        throw e;
      }
    } else {
      const { error, value } = validateReferralInput(req.body);
      if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);
      await assertReferable(value.email, { referrer });
      try {
        referral = await DoctorReferral.create({
          referrerDoctorId: referrer._id,
          referredName: value.name,
          referredEmail: value.email,
          referredPhone: value.phone,
          note: value.note,
          source: 'admin',
          createdBy: req.userId,
          ...statusFields('submitted'),
        });
      } catch (e) {
        if (isDuplicateKey(e)) return sendError(res, HTTP_STATUS.CONFLICT, ALREADY_REFERRED);
        throw e;
      }
    }
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_CREATED,
      resourceType: 'doctor_referral',
      resourceId: referral._id,
      metadata: { referrerDoctorId: String(referrer._id), status: referral.status },
    });
    await notifyReferrer(referral, referral.status === 'invited' ? 'invited' : 'submitted');
    return respondReferral(res, HTTP_STATUS.CREATED, 'Referral recorded', referral._id);
  } catch (error) {
    handle(res, next, error);
  }
};

/**
 * POST /api/admin/referrals/:id/approve — invite the referred gynac
 * { specialty, pricePerSession, name?, email?, ...invite fields }.
 */
export const approveReferral = async (req, res, next) => {
  try {
    const referral = await loadReferral(req.params.id);
    if (referral.status !== 'submitted') {
      throw new ReferralError('Only a referral in review can be approved', 409, 'BAD_TRANSITION');
    }
    const referrer = await Doctor.findOne({ _id: referral.referrerDoctorId, deletedAt: null })
      .select('_id name')
      .lean();
    if (!referrer) {
      throw new ReferralError(
        'The referring gynac was removed — reject this referral or reassign it',
        409,
        'REFERRER_GONE',
      );
    }
    const body = req.body || {};
    const name = String(body.name || referral.referredName).trim();
    // The email is the referral's: changing it would let anyone claim the reward.
    const email = referral.referredEmail;

    // Claim it first, so a double click can't send two invites.
    const claimed = await moveReferral(referral, 'invited', {
      reviewedBy: req.userId,
      reviewedAt: new Date(),
      invitedAt: new Date(),
    });
    let invite;
    try {
      invite = await createDoctorInvite({ ...body, name, email }, { referredBy: referrer.name });
    } catch (error) {
      // Put it back in review so the admin can fix the details and retry.
      await DoctorReferral.updateOne(
        { _id: claimed._id, status: 'invited', referredDoctorId: null },
        {
          $set: statusFields('submitted'),
          $unset: { reviewedBy: 1, reviewedAt: 1, invitedAt: 1 },
        },
      );
      if (error instanceof DoctorInviteError) return sendError(res, error.status, error.message);
      throw error;
    }
    await DoctorReferral.updateOne(
      { _id: claimed._id },
      { $set: { referredDoctorId: invite.doctor._id, referredName: invite.doctor.name } },
    );

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_APPROVED,
      resourceType: 'doctor_referral',
      resourceId: referral._id,
      metadata: { doctorId: String(invite.doctor._id), referrerDoctorId: String(referrer._id) },
    });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.DOCTOR_INVITED,
      resourceType: 'doctor',
      resourceId: invite.doctor._id,
      metadata: { email, referralId: String(referral._id) },
    });
    await notifyReferrer(claimed, 'invited');
    const fresh = await populateReferral(DoctorReferral.findById(referral._id)).lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Invite sent', {
      referral: describeReferral(fresh),
      inviteUrl: invite.inviteUrl,
      inviteEmailDelivered: invite.inviteEmailDelivered,
    });
  } catch (error) {
    handle(res, next, error);
  }
};

/** POST /api/admin/referrals/:id/reject { reason } */
export const rejectReferral = async (req, res, next) => {
  try {
    const reason = cleanReason(req.body?.reason);
    if (reason.length < 3)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Give a reason (the gynac sees it)');
    const referral = await loadReferral(req.params.id);
    const updated = await moveReferral(referral, 'rejected', {
      closeReason: reason,
      reviewedBy: req.userId,
      reviewedAt: new Date(),
    });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_REJECTED,
      resourceType: 'doctor_referral',
      resourceId: referral._id,
      metadata: { reason },
    });
    await notifyReferrer(updated, 'rejected');
    return respondReferral(res, HTTP_STATUS.OK, 'Referral rejected', referral._id);
  } catch (error) {
    handle(res, next, error);
  }
};

/**
 * POST /api/admin/referrals/:id/cancel { reason } — close a referral that
 * is in review or invited without a reward (the invite itself stays; manage
 * the gynac from Gynecologists).
 */
export const cancelReferral = async (req, res, next) => {
  try {
    const reason = cleanReason(req.body?.reason);
    if (reason.length < 3) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Give a reason');
    const referral = await loadReferral(req.params.id);
    const updated = await moveReferral(referral, 'cancelled', {
      closeReason: reason,
      reviewedBy: req.userId,
      reviewedAt: new Date(),
    });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_CANCELLED,
      resourceType: 'doctor_referral',
      resourceId: referral._id,
      metadata: { reason, from: referral.status },
    });
    await notifyReferrer(updated, 'cancelled');
    return respondReferral(res, HTTP_STATUS.OK, 'Referral cancelled', referral._id);
  } catch (error) {
    handle(res, next, error);
  }
};

/** PATCH /api/admin/referrals/:id/referrer { referrerDoctorId, reason? } — before onboarding only. */
export const reassignReferrer = async (req, res, next) => {
  try {
    const { referrerDoctorId } = req.body || {};
    if (!isValidObjectId(referrerDoctorId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Choose the referring gynac');
    }
    const referral = await loadReferral(req.params.id);
    if (!OPEN_REFERRAL_STATUSES.includes(referral.status)) {
      throw new ReferralError(
        'The referrer can only change before the gynac joins',
        409,
        'BAD_TRANSITION',
      );
    }
    if (String(referral.referrerDoctorId) === String(referrerDoctorId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'That gynac is already the referrer');
    }
    const referrer = await Doctor.findOne({ _id: referrerDoctorId, deletedAt: null })
      .select('_id name email')
      .lean();
    if (!referrer) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Referring gynac not found');
    if (
      referrer.email === referral.referredEmail ||
      String(referrer._id) === String(referral.referredDoctorId)
    ) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A gynac cannot refer themselves');
    }
    const from = referral.referrerDoctorId;
    const updated = await DoctorReferral.findOneAndUpdate(
      { _id: referral._id, status: referral.status, referrerDoctorId: from },
      { $set: { referrerDoctorId: referrer._id } },
      { new: true },
    );
    if (!updated)
      throw new ReferralError('This referral just changed — refresh and try again', 409, 'STALE');
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_REASSIGNED,
      resourceType: 'doctor_referral',
      resourceId: referral._id,
      metadata: {
        from: String(from),
        to: String(referrer._id),
        reason: cleanReason(req.body.reason) || undefined,
      },
    });
    return respondReferral(res, HTTP_STATUS.OK, 'Referrer changed', referral._id);
  } catch (error) {
    handle(res, next, error);
  }
};

/* ------------------------------- Credits ------------------------------- */

/** GET /api/admin/referrals/credits?doctorId=&state=&page=&limit= */
export const listCredits = async (req, res, next) => {
  try {
    const filter = {};
    if (req.query.doctorId) {
      if (!isValidObjectId(req.query.doctorId)) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid gynac id');
      }
      filter.doctorId = req.query.doctorId;
    }
    if (['active', 'revoked', 'expired'].includes(req.query.status))
      filter.status = req.query.status;
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const [rows, total] = await Promise.all([
      ReferralCredit.find(filter)
        .populate('doctorId', 'name email avatarUrl')
        .populate('referralId', 'referredName')
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ReferralCredit.countDocuments(filter),
    ]);
    return sendResponse(res, HTTP_STATUS.OK, 'Credits fetched', {
      credits: rows.map((c) => describeCredit(c)),
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/referrals/credits { doctorId, sessions, reason, expiryDays? } — a bonus. */
export const grantBonusCredit = async (req, res, next) => {
  try {
    const { doctorId } = req.body || {};
    if (!isValidObjectId(doctorId))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Choose a gynac');
    const sessions = intInRange(req.body.sessions, 1, 50);
    if (sessions === null)
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Sessions must be 1 to 50');
    const reason = cleanReason(req.body.reason);
    if (reason.length < 3) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Give a reason');
    let expiryDays = null;
    if (
      req.body.expiryDays !== undefined &&
      req.body.expiryDays !== null &&
      req.body.expiryDays !== ''
    ) {
      expiryDays = intInRange(req.body.expiryDays, 1, 3650);
      if (expiryDays === null)
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Expiry must be 1 to 3650 days');
    }
    const doctor = await Doctor.findOne({ _id: doctorId, deletedAt: null })
      .select('_id name')
      .lean();
    if (!doctor) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Gynac not found');

    const { credit } = await grantCredit({
      doctorId: doctor._id,
      kind: 'manual',
      sessions,
      reason,
      createdBy: req.userId,
      expiryDays,
    });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_CREDIT_GRANTED,
      resourceType: 'referral_credit',
      resourceId: credit._id,
      metadata: { doctorId: String(doctor._id), sessions, reason, expiryDays },
    });
    const fresh = await ReferralCredit.findById(credit._id)
      .populate('doctorId', 'name email avatarUrl')
      .lean();
    return sendResponse(res, HTTP_STATUS.CREATED, 'Free sessions granted', describeCredit(fresh));
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/referrals/credits/:id/revoke { reason } — takes back unused sessions only. */
export const revokeCreditById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid credit id');
    const reason = cleanReason(req.body?.reason);
    if (reason.length < 3) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Give a reason');
    const credit = await revokeCredit(req.params.id, { adminId: req.userId, reason });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_CREDIT_REVOKED,
      resourceType: 'referral_credit',
      resourceId: credit._id,
      metadata: {
        doctorId: String(credit.doctorId),
        sessionsRevoked: credit.sessionsRevoked,
        reason,
      },
    });
    const fresh = await ReferralCredit.findById(credit._id)
      .populate('doctorId', 'name email avatarUrl')
      .populate('referralId', 'referredName')
      .lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Credit revoked', describeCredit(fresh));
  } catch (error) {
    handle(res, next, error);
  }
};

/* ------------------------------- Settings ------------------------------ */

/** GET /api/admin/referrals/settings */
export const getSettings = async (req, res, next) => {
  try {
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Referral settings',
      describeReferralSettings(await getReferralSettings()),
    );
  } catch (error) {
    next(error);
  }
};

/** PUT /api/admin/referrals/settings { enabled?, rewardSessions?, creditExpiryDays?, maxOpenPerDoctor? } */
export const updateSettings = async (req, res, next) => {
  try {
    const b = req.body || {};
    const $set = {};
    const bad = (msg) => sendError(res, HTTP_STATUS.BAD_REQUEST, msg);
    if (b.enabled !== undefined) {
      if (typeof b.enabled !== 'boolean') return bad('enabled must be true or false');
      $set.referralProgramEnabled = b.enabled;
    }
    if (b.rewardTrigger !== undefined) {
      if (!['onboarded', 'first_session'].includes(b.rewardTrigger)) {
        return bad('Reward must be given on joining or after the first session');
      }
      $set.referralRewardTrigger = b.rewardTrigger;
    }
    if (b.rewardSessions !== undefined) {
      const n = intInRange(b.rewardSessions, 1, 50);
      if (n === null) return bad('Sessions per referral must be 1 to 50');
      $set.referralRewardSessions = n;
    }
    if (b.creditExpiryDays !== undefined) {
      if (b.creditExpiryDays === null || b.creditExpiryDays === '' || b.creditExpiryDays === 0) {
        $set.referralCreditExpiryDays = null;
      } else {
        const n = intInRange(b.creditExpiryDays, 1, 3650);
        if (n === null) return bad('Expiry must be 1 to 3650 days, or empty for never');
        $set.referralCreditExpiryDays = n;
      }
    }
    if (b.maxOpenPerDoctor !== undefined) {
      const n = intInRange(b.maxOpenPerDoctor, 1, 100);
      if (n === null) return bad('Open referrals per gynac must be 1 to 100');
      $set.referralMaxOpenPerDoctor = n;
    }
    if (Object.keys($set).length === 0) return bad('Nothing to update');
    await getReferralSettings(); // make sure the row exists
    const updated = await ClinicalPayoutSettings.findOneAndUpdate(
      { key: 'default' },
      { $set: { ...$set, updatedBy: req.userId } },
      { new: true },
    ).lean();
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.REFERRAL_SETTINGS_UPDATED,
      resourceType: 'referral_settings',
      metadata: { changes: $set },
    });
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Referral settings saved',
      describeReferralSettings(updated),
    );
  } catch (error) {
    next(error);
  }
};
