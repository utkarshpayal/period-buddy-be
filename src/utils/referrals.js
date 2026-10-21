import ClinicalPayoutSettings from '../models/ClinicalPayoutSettings.js';
import Consultation from '../models/Consultation.js';
import Doctor from '../models/Doctor.js';
import DoctorReferral from '../models/DoctorReferral.js';
import ReferralCredit from '../models/ReferralCredit.js';
import User from '../models/User.js';
import logger from './logger.js';
import { sendMail } from './mailer.js';
import { recordAudit, AUDIT_ACTIONS } from './auditLog.js';
import { broadcastToRoom } from '../config/websocket.js';
import { getDoctorPayoutTemplate } from '../templates/emailTemplates.js';
import { fromMinor } from './payoutMath.js';
import { adminAppBaseUrl } from './invite.js';
import { PERMISSIONS, hasPermission, STAFF_ROLES } from '../config/permissions.js';
import {
  compareCreditUse,
  creditExpiryFor,
  creditState,
  remainingOnCredit,
  shouldUseFreeSession,
  statusFields,
} from './referralMath.js';

/**
 * Gynac referral program: a gynac refers a colleague, a Clinical Admin
 * invites them, and once the colleague sets their password the referrer gets
 * a credit of commission-free sessions (the Admin Workspace repo's
 * docs/gynac-referrals-plan.md).
 *
 * Credits are spent from utils/doctorWallet.js#recordConsultationEarning
 * (reserveFreeSession) and given back when that earning is reversed before
 * the session was completed (releaseFreeSession). Both are atomic and keyed
 * on the consultation, so the reconciler re-running or two hooks racing can
 * never spend or return a session twice.
 *
 * This module deliberately doesn't import doctorWallet.js (it imports us).
 */

export class ReferralError extends Error {
  constructor(message, status = 400, code = 'REFERRAL_ERROR') {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/* ------------------------------- Settings ------------------------------ */

export const getReferralSettings = async () => {
  const settings = await ClinicalPayoutSettings.findOneAndUpdate(
    { key: 'default' },
    { $setOnInsert: { key: 'default' } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return settings.toObject();
};

export const describeReferralSettings = (s) => ({
  enabled: s.referralProgramEnabled !== false,
  rewardTrigger: s.referralRewardTrigger === 'first_session' ? 'first_session' : 'onboarded',
  rewardSessions: s.referralRewardSessions ?? 5,
  creditExpiryDays: s.referralCreditExpiryDays ?? null,
  maxOpenPerDoctor: s.referralMaxOpenPerDoctor ?? 10,
  updatedAt: s.updatedAt,
});

/* ------------------------------ Describe ------------------------------- */

const idOf = (value) => (value?._id ? value._id : value);

const doctorRef = (d) =>
  d && d._id ? { _id: d._id, name: d.name, email: d.email, avatarUrl: d.avatarUrl } : null;

export const describeReferral = (r) => ({
  _id: r._id,
  referrer: doctorRef(r.referrerDoctorId) || { _id: idOf(r.referrerDoctorId) },
  referredName: r.referredName,
  referredEmail: r.referredEmail,
  referredPhone: r.referredPhone,
  note: r.note,
  source: r.source,
  status: r.status,
  referredDoctor: doctorRef(r.referredDoctorId),
  closeReason: r.closeReason,
  reviewedAt: r.reviewedAt,
  invitedAt: r.invitedAt,
  onboardedAt: r.onboardedAt,
  rewardStatus: r.rewardStatus,
  rewardSkipReason: r.rewardSkipReason,
  rewardSessions: r.rewardSessions,
  creditId: r.creditId,
  createdAt: r.createdAt,
  updatedAt: r.updatedAt,
});

/** The referral as its referrer sees it (no admin-only fields). */
export const describeReferralForReferrer = (r) => {
  const { referrer: _referrer, referredDoctor, ...rest } = describeReferral(r);
  return { ...rest, joined: Boolean(referredDoctor) && r.status === 'onboarded' };
};

export const describeCredit = (c, now = new Date()) => ({
  _id: c._id,
  doctor: doctorRef(c.doctorId) || { _id: idOf(c.doctorId) },
  kind: c.kind,
  referralId: idOf(c.referralId),
  referredName: c.referralId?.referredName,
  sessionsGranted: c.sessionsGranted,
  sessionsUsed: c.sessionsUsed,
  sessionsRemaining: remainingOnCredit(c, now),
  sessionsRevoked: c.sessionsRevoked || 0,
  state: creditState(c, now),
  grantedAt: c.grantedAt,
  expiresAt: c.expiresAt,
  reason: c.reason,
  revokedAt: c.revokedAt,
  revokeReason: c.revokeReason,
  commissionSaved: fromMinor(
    (c.usages || []).reduce((sum, u) => sum + (u.commissionSavedMinor || 0), 0),
  ),
  usages: (c.usages || []).map((u) => ({
    consultationId: u.consultationId,
    commissionSaved: fromMinor(u.commissionSavedMinor || 0),
    usedAt: u.usedAt,
  })),
  createdAt: c.createdAt,
});

/* ---------------------------- Notifications ---------------------------- */

/** Refresh the gynac's open portal (their `user_<id>` room). */
const pingPortal = (doctor, payload = {}) => {
  try {
    if (doctor?.userId) {
      broadcastToRoom(`user_${idOf(doctor.userId)}`, { type: 'referral_updated', ...payload });
    }
  } catch {
    // live refresh is a nicety; the portal also reloads on focus
  }
};

const emailDoctor = async (doctor, template) => {
  try {
    const to = doctor.email || (await User.findById(doctor.userId).select('email').lean())?.email;
    if (!to) return;
    await sendMail({
      to,
      subject: template.heading,
      html: getDoctorPayoutTemplate({ name: doctor.name, ...template }),
    });
  } catch (error) {
    logger.error('referral_email_failed', {
      action: 'referral_email_failed',
      error: error.message,
    });
  }
};

/** What the referrer is emailed at each step (null = portal refresh only). */
const referrerEmailFor = (referral, kind) => {
  const name = referral.referredName;
  switch (kind) {
    case 'submitted':
      return {
        badge: 'Referral received',
        heading: `Thanks for referring ${name}`,
        body: `We've received your referral of ${name}. The Nura clinical team will review it and invite them.`,
        lines: [['Colleague', `${name} (${referral.referredEmail})`]],
        footer: `When they join Nura, you get ${referral.rewardSessions ?? 5} commission-free sessions. You can follow it in Refer & Earn on your portal.`,
      };
    case 'sent':
      return {
        badge: 'Referral sent',
        heading: `Your invite to ${name} is on its way`,
        body: `Thanks for referring ${name}! We've emailed them an invitation to join Nura as a clinician.`,
        lines: [['Colleague', `${name} (${referral.referredEmail})`]],
        footer: `When they set up their account, you get ${referral.rewardSessions ?? 5} commission-free sessions. You can follow it in Refer & Earn on your portal.`,
      };
    case 'invited':
      return {
        badge: 'Referral update',
        heading: `${name} has been invited to Nura`,
        body: `Good news: we've invited ${name} to join Nura as a clinician.`,
        footer: 'Your commission-free sessions are added as soon as they set up their account.',
      };
    case 'joined':
      return {
        badge: 'Referral update',
        heading: `${name} has joined Nura`,
        body: `${name} has set up their Nura account through your referral. Thank you!`,
        footer: `Your ${referral.rewardSessions ?? 5} commission-free sessions are added after their first completed consultation.`,
      };
    case 'rejected':
      return {
        badge: 'Referral update',
        heading: 'About your referral',
        body: `We couldn't take your referral of ${name} forward this time.`,
        lines: referral.closeReason ? [['Reason', referral.closeReason]] : [],
        footer: 'Thank you for thinking of Nura. You can refer other colleagues from your portal.',
      };
    case 'cancelled':
      return {
        badge: 'Referral update',
        heading: 'Your referral was closed',
        body: `Your referral of ${name} has been closed without a reward.`,
        lines: referral.closeReason ? [['Reason', referral.closeReason]] : [],
        footer: 'Questions? Just reply to this email.',
      };
    case 'rewarded':
      return {
        badge: 'Referral reward',
        heading: `You've earned ${referral.rewardSessions} commission-free sessions`,
        body: `${name} has joined Nura through your referral. Thank you!`,
        lines: [['Commission-free sessions', String(referral.rewardSessions)]],
        footer:
          'Nura takes no commission on your next paid sessions until they are used up. ' +
          'You can see them in Refer & Earn on your portal.',
      };
    default:
      return null;
  }
};

/** Refresh the referrer's portal and email them about this step. Never throws. */
export const notifyReferrer = async (referral, kind) => {
  try {
    const referrer = await Doctor.findById(idOf(referral.referrerDoctorId))
      .select('name email userId')
      .lean();
    if (!referrer) return;
    pingPortal(referrer, { referralId: String(referral._id), status: referral.status });
    const template = referrerEmailFor(referral, kind);
    if (template) await emailDoctor(referrer, template);
  } catch (error) {
    logger.error('referral_notify_failed', {
      action: 'referral_notify_failed',
      kind,
      error: error.message,
    });
  }
};

/** Staff roles that can act on referrals (Clinical Admin, Super Admin). */
const reviewerRoles = () =>
  Object.keys(STAFF_ROLES).filter((role) => hasPermission(role, PERMISSIONS.REFERRALS_MANAGE));

/**
 * A new referral is waiting: email everyone who can review it, one email
 * each (no shared recipient list). Never throws.
 */
export const notifyReviewers = async (referral, referrerName) => {
  try {
    const reviewers = await User.find({
      role: { $in: reviewerRoles() },
      isActive: true,
      deletedAt: null,
    })
      .select('email firstName')
      .lean();
    const link = `${adminAppBaseUrl()}/gynac-referrals`;
    await Promise.all(
      reviewers
        .filter((u) => u.email)
        .map((u) =>
          sendMail({
            to: u.email,
            subject:
              referral.status === 'invited'
                ? `A gynac invited a colleague: ${referral.referredName}`
                : `New gynac referral to review: ${referral.referredName}`,
            html: getDoctorPayoutTemplate({
              name: u.firstName,
              badge: referral.status === 'invited' ? 'New referral' : 'Referral to review',
              heading:
                referral.status === 'invited'
                  ? 'A colleague was referred and invited'
                  : 'A new gynac referral is waiting',
              body:
                referral.status === 'invited'
                  ? `${referrerName || 'A gynecologist'} referred a colleague, who has been emailed an invite. ` +
                    'Their bookings stay paused until they join. Close the referral or deactivate them in the Admin Workspace if something looks wrong.'
                  : `${referrerName || 'A gynecologist'} has referred a colleague to Nura.`,
              lines: [
                ['Colleague', referral.referredName],
                ['Email', referral.referredEmail],
                ...(referral.referredPhone ? [['Phone', referral.referredPhone]] : []),
                ...(referral.note ? [['Note', referral.note]] : []),
              ],
              footer: `See it in the Admin Workspace: ${link}`,
            }),
          }),
        ),
    );
  } catch (error) {
    logger.error('referral_reviewer_email_failed', {
      action: 'referral_reviewer_email_failed',
      error: error.message,
    });
  }
};

/* ------------------------------- Credits ------------------------------- */

/** Give a gynac commission-free sessions (a referral reward or an admin bonus). */
export const grantCredit = async ({
  doctorId,
  kind,
  referralId,
  sessions,
  reason,
  createdBy,
  expiryDays,
  now = new Date(),
}) => {
  try {
    const credit = await ReferralCredit.create({
      doctorId,
      kind,
      ...(referralId ? { referralId } : {}),
      sessionsGranted: sessions,
      grantedAt: now,
      expiresAt: creditExpiryFor(now, expiryDays),
      reason,
      createdBy,
    });
    return { credit, created: true };
  } catch (error) {
    // The reward for this referral already exists (the hook ran twice).
    if (error?.code === 11000 && referralId) {
      return { credit: await ReferralCredit.findOne({ referralId }), created: false };
    }
    throw error;
  }
};

/** Commission-free sessions a gynac can still use, right now. */
export const freeSessionsRemaining = async (doctorId, now = new Date()) => {
  const credits = await ReferralCredit.find({ doctorId, status: 'active' })
    .select('status sessionsGranted sessionsUsed expiresAt')
    .lean();
  return credits.reduce((sum, c) => sum + remainingOnCredit(c, now), 0);
};

/** { doctorId: remaining } for a page of doctors (admin list). */
export const freeSessionsRemainingFor = async (doctorIds, now = new Date()) => {
  const credits = await ReferralCredit.find({ doctorId: { $in: doctorIds }, status: 'active' })
    .select('doctorId status sessionsGranted sessionsUsed expiresAt')
    .lean();
  const totals = new Map();
  for (const c of credits) {
    const key = String(c.doctorId);
    totals.set(key, (totals.get(key) || 0) + remainingOnCredit(c, now));
  }
  return totals;
};

/**
 * Spend one free session on a paid consultation, if the gynac has one and
 * it applies (see referralMath#shouldUseFreeSession). Idempotent per
 * consultation: a consultation already on a credit returns that credit.
 * Returns the credit used, or null.
 */
export const reserveFreeSession = async ({
  doctorId,
  consultationId,
  paidAt,
  commissionMinor,
  now = new Date(),
}) => {
  if (!(commissionMinor > 0) || !paidAt) return null;
  const already = await ReferralCredit.findOne({ 'usages.consultationId': consultationId }).lean();
  if (already) return already;

  const candidates = (
    await ReferralCredit.find({
      doctorId,
      status: 'active',
      grantedAt: { $lte: paidAt },
      $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
    })
      .select('sessionsGranted sessionsUsed status expiresAt grantedAt createdAt')
      .lean()
  )
    .filter(
      (c) =>
        remainingOnCredit(c, now) > 0 &&
        shouldUseFreeSession({ commissionMinor, paidAt, grantedAt: c.grantedAt }),
    )
    .sort(compareCreditUse);

  for (const candidate of candidates) {
    // Compare-and-set: still active, still has room, not already used for
    // this consultation. Losing a race just moves on to the next credit.
    const credit = await ReferralCredit.findOneAndUpdate(
      {
        _id: candidate._id,
        status: 'active',
        'usages.consultationId': { $ne: consultationId },
        $expr: { $lt: ['$sessionsUsed', '$sessionsGranted'] },
      },
      {
        $inc: { sessionsUsed: 1 },
        $push: { usages: { consultationId, commissionSavedMinor: commissionMinor, usedAt: now } },
      },
      { new: true },
    ).lean();
    if (credit) return credit;
    // Lost the race: if a concurrent hook for this same consultation took a
    // session (on this or any credit), share it rather than taking a second.
    const taken = await ReferralCredit.findOne({ 'usages.consultationId': consultationId }).lean();
    if (taken) return taken;
  }
  return null;
};

/**
 * Give a consultation's free session back (its earning was reversed before
 * the session happened, or the earning insert lost a race). Idempotent.
 */
export const releaseFreeSession = async (consultationId, { creditId } = {}) => {
  const credit = await ReferralCredit.findOneAndUpdate(
    { ...(creditId ? { _id: creditId } : {}), 'usages.consultationId': consultationId },
    { $inc: { sessionsUsed: -1 }, $pull: { usages: { consultationId } } },
    { new: true },
  ).lean();
  if (credit && credit.status !== 'active') {
    // The credit was revoked or expired meanwhile: the session can't come
    // back, so count it with the ones taken away (totals keep adding up).
    await ReferralCredit.updateOne({ _id: credit._id }, { $inc: { sessionsRevoked: 1 } });
  }
  if (credit) {
    logger.info('referral_free_session_released', {
      action: 'referral_free_session_released',
      creditId: String(credit._id),
      consultationId: String(consultationId),
    });
    const doctor = await Doctor.findById(credit.doctorId).select('userId').lean();
    pingPortal(doctor);
  }
  return credit;
};

/** Take back a credit's unused sessions. Sessions already used stay free. */
export const revokeCredit = async (creditId, { adminId, reason, now = new Date() }) => {
  const result = await ReferralCredit.updateOne({ _id: creditId, status: 'active' }, [
    {
      $set: {
        status: 'revoked',
        revokedAt: now,
        revokedBy: adminId,
        revokeReason: reason,
        sessionsRevoked: { $max: [0, { $subtract: ['$sessionsGranted', '$sessionsUsed'] }] },
      },
    },
  ]);
  if (!result.modifiedCount) {
    const exists = await ReferralCredit.exists({ _id: creditId });
    if (!exists) throw new ReferralError('Credit not found', 404, 'NOT_FOUND');
    throw new ReferralError('Only an active credit can be revoked', 409, 'NOT_ACTIVE');
  }
  const credit = await ReferralCredit.findById(creditId).lean();
  const doctor = await Doctor.findById(credit.doctorId).select('userId').lean();
  pingPortal(doctor);
  return credit;
};

/** Mark lapsed credits expired (payout runner). */
export const expireReferralCredits = async (now = new Date()) => {
  const result = await ReferralCredit.updateMany(
    { status: 'active', expiresAt: { $ne: null, $lte: now } },
    { $set: { status: 'expired' } },
  );
  return result.modifiedCount || 0;
};

/* ------------------------------ Referrals ------------------------------ */

/** When the reward is given: 'onboarded' (sets their password) or 'first_session'. */
export const rewardTriggerOf = (settings) =>
  settings?.referralRewardTrigger === 'first_session' ? 'first_session' : 'onboarded';

/**
 * Give a joined referral its reward (idempotent: the credit is unique per
 * referral, and only a still-pending referral is processed).
 */
export const grantReferralReward = async (referralOrId, { settings, now = new Date() } = {}) => {
  const referral =
    referralOrId instanceof DoctorReferral
      ? referralOrId
      : await DoctorReferral.findById(referralOrId);
  if (!referral || referral.status !== 'onboarded' || referral.rewardStatus !== 'pending')
    return null;

  const [referrer, cfg] = await Promise.all([
    Doctor.findById(referral.referrerDoctorId).select('_id name email userId deletedAt').lean(),
    settings ? Promise.resolve(settings) : getReferralSettings(),
  ]);
  const skip = async (why) => {
    referral.rewardStatus = 'skipped';
    referral.rewardSkipReason = why;
    await referral.save();
    logger.warn('referral_reward_skipped', {
      action: 'referral_reward_skipped',
      referralId: String(referral._id),
      reason: why,
    });
    return referral;
  };
  if (!referrer || referrer.deletedAt) return skip('The referring gynac was removed from Nura');
  if (String(referrer._id) === String(referral.referredDoctorId)) return skip('Self-referral');

  // The size promised when they referred (snapshot), else today's setting.
  // The program switch only stops new referrals; one already in flight is
  // still rewarded (docs/gynac-referrals-plan.md, Q3).
  const sessions = referral.rewardSessions ?? cfg.referralRewardSessions ?? 5;
  const { credit, created } = await grantCredit({
    doctorId: referrer._id,
    kind: 'referral',
    referralId: referral._id,
    sessions,
    reason: `Referred ${referral.referredName}`,
    expiryDays: cfg.referralCreditExpiryDays,
    now,
  });
  referral.rewardStatus = 'granted';
  referral.rewardSessions = credit.sessionsGranted;
  referral.creditId = credit._id;
  await referral.save();

  if (created) {
    await recordAudit({
      req: null,
      action: AUDIT_ACTIONS.REFERRAL_REWARD_GRANTED,
      resourceType: 'doctor_referral',
      resourceId: referral._id,
      metadata: {
        referrerDoctorId: String(referrer._id),
        referredDoctorId: String(referral.referredDoctorId),
        sessions: credit.sessionsGranted,
        trigger: rewardTriggerOf(cfg),
      },
    });
    logger.info('referral_reward_granted', {
      action: 'referral_reward_granted',
      referralId: String(referral._id),
      referrerDoctorId: String(referrer._id),
      sessions: credit.sessionsGranted,
    });
    await notifyReferrer(referral, 'rewarded');
  }
  return referral;
};

/**
 * The referred gynac just set their password (doctorController
 * #setPasswordFromInvite): mark their referral joined, and reward the
 * referrer now, or after the colleague's first completed paid consultation
 * when the program is set to (grantDueReferralRewards). Best-effort and
 * idempotent: only one caller wins the status move.
 */
export const completeReferralOnboarding = async (userId, now = new Date()) => {
  const doctor = await Doctor.findOne({ userId }).select('_id name email').lean();
  if (!doctor) return null;
  // Normally matched by the invited Doctor. If a crash left the referral
  // without it, the email still ties them together.
  const referral = await DoctorReferral.findOneAndUpdate(
    {
      $or: [
        { referredDoctorId: doctor._id, status: 'invited' },
        {
          referredEmail: doctor.email,
          referredDoctorId: { $in: [null, doctor._id] },
          status: { $in: ['invited', 'submitted'] },
        },
      ],
    },
    { $set: { ...statusFields('onboarded'), onboardedAt: now, referredDoctorId: doctor._id } },
    { new: true },
  );
  if (!referral) return null;

  const settings = await getReferralSettings();
  if (rewardTriggerOf(settings) === 'first_session') {
    await notifyReferrer(referral, 'joined');
    return referral;
  }
  return grantReferralReward(referral, { settings, now });
};

/**
 * Payout runner: rewards that are due. Retries any grant that failed, and
 * under the 'first_session' trigger rewards referrals whose colleague has
 * now completed a paid consultation.
 */
export const grantDueReferralRewards = async ({ limit = 200 } = {}) => {
  const pending = await DoctorReferral.find({ status: 'onboarded', rewardStatus: 'pending' })
    .sort({ onboardedAt: 1 })
    .limit(limit);
  if (pending.length === 0) return 0;
  const settings = await getReferralSettings();
  const trigger = rewardTriggerOf(settings);
  let granted = 0;
  for (const referral of pending) {
    try {
      if (trigger === 'first_session') {
        const sessionDone = await Consultation.exists({
          doctorId: referral.referredDoctorId,
          status: 'completed',
          paymentStatus: 'paid',
        });
        if (!sessionDone) continue;
      }
      const result = await grantReferralReward(referral, { settings });
      if (result?.rewardStatus === 'granted') granted += 1;
    } catch (error) {
      logger.error('referral_reward_retry_failed', {
        action: 'referral_reward_retry_failed',
        referralId: String(referral._id),
        error: error.message,
      });
    }
  }
  return granted;
};

/**
 * The referred gynac was deactivated or deleted before onboarding: their
 * referral can't complete any more. (An admin can attach a new one after
 * reactivating them.)
 */
export const cancelReferralsForDoctor = async (doctorId, reason) => {
  const open = await DoctorReferral.find({ referredDoctorId: doctorId, status: 'invited' })
    .select('_id referrerDoctorId referredName')
    .lean();
  if (open.length === 0) return 0;
  await DoctorReferral.updateMany(
    { _id: { $in: open.map((r) => r._id) }, status: 'invited' },
    { $set: { ...statusFields('cancelled'), closeReason: reason } },
  );
  for (const r of open) {
    await notifyReferrer({ ...r, ...statusFields('cancelled'), closeReason: reason }, 'cancelled');
  }
  return open.length;
};

/** Who referred each of these doctors (admin doctor list). */
export const referrersFor = async (doctorIds) => {
  const rows = await DoctorReferral.find({
    referredDoctorId: { $in: doctorIds },
    status: { $in: ['invited', 'onboarded'] },
  })
    .populate('referrerDoctorId', 'name')
    .select('referredDoctorId referrerDoctorId status')
    .lean();
  return new Map(
    rows.map((r) => [
      String(r.referredDoctorId),
      {
        referralId: r._id,
        status: r.status,
        doctorId: r.referrerDoctorId?._id,
        name: r.referrerDoctorId?.name,
      },
    ]),
  );
};
