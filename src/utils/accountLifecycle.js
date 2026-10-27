/**
 * Account lifecycle — the single place that decides what happens to
 * everything linked to an account when it is suspended, deleted, or purged.
 *
 * - softDeleteAccount: the in-app "Delete account" action. The User row is
 *   kept (renamed email, `deletedAt` set, can never be reactivated) so it can
 *   still be purged later through the public "delete my data" flow; every
 *   relationship other people can see is torn down now: posts are hidden,
 *   comments/likes/votes on other people's content are removed, partner and
 *   buddy links are ended (the other side is told), Bestie Circles are left
 *   (with their vibes), and no more pushes, reminders or check-in calls go out.
 * - suspendAccount: admin suspension. Reversible, so it only cuts what would
 *   otherwise keep running against a locked account (sockets, buddy pairing,
 *   pending workspace approvals) — partner links and content are left alone
 *   and the readers themselves refuse inactive owners.
 * - purgeAccount: the public self-service erasure. Everything above, then
 *   hard-deletes the user's data and files. Paid consultations are kept
 *   (stripped of their contents) so doctor earnings and the payment trail
 *   don't silently change.
 *
 * Every step is idempotent, so re-running any of these on the same account
 * (e.g. the startup backfill for accounts deleted before this existed) is safe.
 */
import mongoose from 'mongoose';
import { leaveAllCircles } from './circleMembership.js';
import User from '../models/User.js';
import { revokeAllSessions } from './sessions.js';
import Partner from '../models/Partner.js';
import PartnerMessage from '../models/PartnerMessage.js';
import Notification from '../models/Notification.js';
import BuddyMatch from '../models/BuddyMatch.js';
import BuddyMessage from '../models/BuddyMessage.js';
import Nomination from '../models/Nomination.js';
import CommunityPost from '../models/Community.js';
import CommunityLike from '../models/CommunityLike.js';
import Comment from '../models/Comment.js';
import Reel from '../models/Reel.js';
import ReelLike from '../models/ReelLike.js';
import ReelSave from '../models/ReelSave.js';
import ReelComment from '../models/ReelComment.js';
import Doctor from '../models/Doctor.js';
import DoctorAvailability from '../models/DoctorAvailability.js';
import Consultation from '../models/Consultation.js';
import ConsultationMessage from '../models/ConsultationMessage.js';
import ChangeRequest from '../models/ChangeRequest.js';
import CycleLog from '../models/CycleLog.js';
import CheckinCall from '../models/CheckinCall.js';
import CycleSettings from '../models/CycleSettings.js';
import Habit from '../models/Habit.js';
import HabitCompletion from '../models/HabitCompletion.js';
import HabitSuggestionDay from '../models/HabitSuggestionDay.js';
import ForestGarden from '../models/ForestGarden.js';
import ForestLog from '../models/ForestLog.js';
import Document from '../models/Document.js';
import DocumentChatMessage from '../models/DocumentChatMessage.js';
import RewardTransaction from '../models/RewardTransaction.js';
import ScreeningAssessment from '../models/ScreeningAssessment.js';
import UserSession from '../models/UserSession.js';
import LaunchInterest from '../models/LaunchInterest.js';
import QaChatSession from '../models/QaChatSession.js';
import SchemeApplication from '../models/SchemeApplication.js';
import Newsletter from '../models/Newsletter.js';
import ContactMessage from '../models/ContactMessage.js';
import SupportTicket from '../models/SupportTicket.js';
import SymptomRecord from '../models/SymptomRecord.js';
import BlogReader from '../models/BlogReader.js';
import PendingSignup from '../models/PendingSignup.js';
import { broadcastToRoom, disconnectUser } from '../config/websocket.js';
import { deleteFromS3, deleteS3Prefix } from './s3.js';
import { deletedEmailFor, originalEmailOf } from './accountStatus.js';
import { isStaffRole } from '../config/permissions.js';
import { userRoleEnum } from '../enums/enums.js';
import logger from './logger.js';
import { reverseConsultationEarnings, safeEarningHook } from './doctorWallet.js';

const OPEN_CONSULTATION_STATUSES = ['pending', 'paid', 'active'];

/** Staff and clinicians are offboarded by an admin, never by self-deletion —
 * a self-delete would skip the last-Super-Admin guard and orphan a bookable
 * Doctor profile. */
export const isSelfDeletionBlocked = (user) =>
  Boolean(user) && (isStaffRole(user.role) || user.role === userRoleEnum.DOCTOR);

/* --------------------------------------------------------------------------
 * Relationship teardown steps
 * ------------------------------------------------------------------------ */

/** End the partner pairing on both sides and tell the counterpart — same
 * effect as partnerController.disconnectPartner, without naming the account
 * that went away. */
export const severPartnerLinks = async (userId) => {
  const rows = await Partner.find({ $or: [{ userId }, { partnerId: userId }] })
    .select('userId partnerId isConnected')
    .lean();
  const counterparts = new Set();
  for (const row of rows) {
    if (!row.isConnected) continue;
    const other = String(row.userId) === String(userId) ? row.partnerId : row.userId;
    if (other && String(other) !== String(userId)) counterparts.add(String(other));
  }

  const disconnected = {
    partnerId: null,
    role: null,
    isConnected: false,
    connectionStatus: 'disconnected',
    connectedAt: null,
  };
  await Promise.all([
    // Own row: also kill any outstanding invite code, so nobody can connect
    // to (and start reading) this account after it's gone.
    Partner.updateMany(
      { userId },
      {
        ...disconnected,
        $unset: { inviteCode: '', inviteCodeExpiry: '', careSuggestionsCache: '' },
      },
    ),
    Partner.updateMany(
      { partnerId: userId, userId: { $ne: userId } },
      { ...disconnected, $unset: { careSuggestionsCache: '' } },
    ),
  ]);

  for (const otherId of counterparts) {
    try {
      const notification = await Notification.create({
        userId: otherId,
        type: 'system',
        title: 'Partner connection ended',
        body: 'Your partner connection has ended because the other account is no longer active.',
        sentAt: new Date(),
      });
      broadcastToRoom(`user_${otherId}`, { type: 'partner_disconnected', notification });
    } catch (error) {
      logger.error('account_partner_notify_failed', {
        action: 'account_partner_notify_failed',
        userId: String(userId),
        partnerId: otherId,
        error: error.message,
      });
    }
  }
  return counterparts.size;
};

/** Delete the user's buddy pairings (and their chat) and tell the other
 * member — same effect as buddyController.endActiveBuddy. */
export const endBuddyMatches = async (userId) => {
  const matches = await BuddyMatch.find({ members: userId }).select('members').lean();
  if (matches.length === 0) return 0;
  const matchIds = matches.map((match) => match._id);
  await BuddyMessage.deleteMany({ matchId: { $in: matchIds } });
  await BuddyMatch.deleteMany({ _id: { $in: matchIds } });
  for (const match of matches) {
    for (const member of match.members) {
      if (String(member) !== String(userId)) {
        broadcastToRoom(`user_${member}`, { type: 'buddy_ended' });
      }
    }
  }
  return matches.length;
};

export const removeNominations = (userId) =>
  Nomination.deleteMany({ $or: [{ nominatorId: userId }, { nomineeId: userId }] });

/**
 * Take a person's likes, saves and comments off reels, moving each reel's
 * counters by exactly the rows removed. Re-running finds nothing left.
 */
const scrubReelFootprint = async (uid) => {
  // Row by row, so a counter only moves for a row this run really deleted.
  const removeEach = async (Model, rows, counterFor) => {
    for (const row of rows) {
      // The deleted document as it was at delete time (isHidden can change).
      const deleted = await Model.findOneAndDelete({ _id: row._id }).lean();
      const counter = deleted ? counterFor(deleted) : null;
      if (counter) {
        await Reel.updateOne(
          { _id: deleted.reelId, [counter]: { $gt: 0 } },
          { $inc: { [counter]: -1 } },
        );
      }
    }
  };

  const [likes, saves, comments] = await Promise.all([
    ReelLike.find({ userId: uid }).select('_id').lean(),
    ReelSave.find({ userId: uid }).select('_id').lean(),
    ReelComment.find({ userId: uid }).select('_id').lean(),
  ]);
  await removeEach(ReelLike, likes, () => 'likeCount');
  await removeEach(ReelSave, saves, () => 'saveCount');
  // Hidden comments were already taken off commentCount when they were hidden.
  await removeEach(ReelComment, comments, (row) => (row.isHidden ? null : 'commentCount'));
  // Their reports on other people's comments (the count stays: it only ever hides).
  await ReelComment.updateMany({ reportedBy: uid }, { $pull: { reportedBy: uid } });
};

/**
 * Hide the user's own posts and take their footprint off everyone else's
 * content: embedded comments, likes, poll votes, reel poll votes and follows,
 * keeping every denormalized counter in step.
 */
export const scrubCommunityFootprint = async (userId, { dropReports = false } = {}) => {
  const uid = toObjectId(userId);

  await CommunityPost.updateMany({ userId: uid, isActive: true }, { isActive: false });

  // Comments are embedded; filter them out and recount in one pipeline update.
  await CommunityPost.updateMany({ 'comments.userId': uid }, [
    {
      $set: {
        comments: {
          $filter: { input: '$comments', cond: { $ne: ['$$this.userId', uid] } },
        },
      },
    },
    { $set: { commentCount: { $size: '$comments' } } },
  ]);

  await CommunityPost.updateMany(
    { likedBy: uid },
    { $pull: { likedBy: uid }, $inc: { likeCount: -1 } },
  );

  const votedPosts = await CommunityPost.find({ 'pollVotes.userId': uid })
    .select('pollVotes')
    .lean();
  for (const post of votedPosts) {
    const vote = post.pollVotes.find((entry) => String(entry.userId) === String(uid));
    await CommunityPost.updateOne(
      { _id: post._id, 'pollVotes.userId': uid },
      {
        $inc: { 'poll.options.$[option].votes': -1 },
        $pull: { pollVotes: { userId: uid } },
      },
      { arrayFilters: [{ 'option.optionId': { $in: vote?.optionIds || [] } }] },
    );
  }

  const votedReels = await Reel.find({ 'votes.userId': uid }).select('votes').lean();
  for (const reel of votedReels) {
    const vote = reel.votes.find((entry) => String(entry.userId) === String(uid));
    await Reel.updateOne(
      { _id: reel._id, 'votes.userId': uid },
      {
        $inc: { 'pollOptions.$[option].votes': -1 },
        $pull: { votes: { userId: uid } },
      },
      { arrayFilters: [{ 'option.optionId': vote?.optionId ?? null }] },
    );
  }
  await Reel.updateMany({ followedBy: uid }, { $pull: { followedBy: uid } });
  await scrubReelFootprint(uid);

  if (dropReports) {
    const user = await User.findById(uid).select('reportedCommunityPosts').lean();
    const reportedIds = (user?.reportedCommunityPosts || []).map((report) => report.postId);
    if (reportedIds.length > 0) {
      await CommunityPost.updateMany(
        { _id: { $in: reportedIds }, reportCount: { $gt: 0 } },
        { $inc: { reportCount: -1 } },
      );
    }
  }
};

/**
 * Take a clinician out of service: hidden from booking, weekly slots off,
 * reels hidden, and every open consultation cancelled with the patient told.
 * Paid ones are logged as needing a refund (there's no automated Cashfree
 * refund flow yet), so finance can act on them.
 */
export const retireDoctorProfiles = async (filter, { reason }) => {
  const doctors = await Doctor.find(filter).select('_id name userId totalConsultations').lean();
  for (const doctor of doctors) {
    await Doctor.updateOne({ _id: doctor._id }, { isAvailable: false });
    await DoctorAvailability.updateMany({ doctorId: doctor._id }, { isAvailable: false });
    await Reel.updateMany({ creatorId: `doctor_${doctor._id}` }, { isActive: false });

    const open = await Consultation.find({
      doctorId: doctor._id,
      status: { $in: OPEN_CONSULTATION_STATUSES },
    })
      .select('userId status paymentStatus amountPaid currency cashfreeOrderId')
      .lean();
    if (open.length === 0) continue;

    await Consultation.updateMany(
      { _id: { $in: open.map((c) => c._id) } },
      {
        status: 'cancelled',
        completedAt: new Date(),
        cancelledBy: 'system',
        cancelReason: 'Doctor no longer available',
      },
    );
    // Paid ones: refunded automatically through Cashfree by the payout runner
    // (utils/consultationRefunds.js; Clinical finance → Refunds shows them),
    // and the doctor's session count corrected.
    const paidIds = open.filter((c) => c.paymentStatus === 'paid').map((c) => c._id);
    if (paidIds.length) {
      await Consultation.updateMany({ _id: { $in: paidIds } }, { refundStatus: 'required' });
      await Doctor.updateOne(
        { _id: doctor._id },
        { $inc: { totalConsultations: -Math.min(paidIds.length, doctor.totalConsultations || 0) } },
      );
    }
    await safeEarningHook('cancelled', () =>
      reverseConsultationEarnings(
        open.map((c) => c._id),
        'Cancelled: doctor no longer available',
      ),
    );

    for (const consultation of open) {
      const paid = consultation.paymentStatus === 'paid';
      if (paid) {
        logger.warn('consultation_refund_required', {
          action: 'consultation_refund_required',
          consultationId: String(consultation._id),
          doctorId: String(doctor._id),
          patientId: String(consultation.userId),
          amountPaid: consultation.amountPaid,
          currency: consultation.currency,
          cashfreeOrderId: consultation.cashfreeOrderId,
          reason,
        });
      }
      try {
        await Notification.create({
          userId: consultation.userId,
          type: 'consultation_update',
          title: 'Consultation cancelled',
          body: paid
            ? `${doctor.name} is no longer available, so your consultation was cancelled. Our team will contact you about a refund.`
            : `${doctor.name} is no longer available, so your consultation was cancelled.`,
          data: { consultationId: String(consultation._id) },
          sentAt: new Date(),
        });
      } catch (error) {
        logger.error('consultation_cancel_notify_failed', {
          action: 'consultation_cancel_notify_failed',
          consultationId: String(consultation._id),
          error: error.message,
        });
      }
    }
  }
  return doctors.length;
};

/** A deleting patient's open bookings are cancelled so the doctor isn't left
 * holding a session with nobody on the other end. */
export const cancelPatientConsultations = async (userId, { reason }) => {
  const open = await Consultation.find({ userId, status: { $in: OPEN_CONSULTATION_STATUSES } })
    .select('doctorId paymentStatus amountPaid currency cashfreeOrderId')
    .lean();
  if (open.length === 0) return 0;
  await Consultation.updateMany(
    { _id: { $in: open.map((c) => c._id) } },
    {
      status: 'cancelled',
      completedAt: new Date(),
      cancelledBy: 'system',
      cancelReason: 'Patient deleted their account',
    },
  );
  const paidIds = open.filter((c) => c.paymentStatus === 'paid').map((c) => c._id);
  if (paidIds.length) {
    await Consultation.updateMany({ _id: { $in: paidIds } }, { refundStatus: 'required' });
    for (const c of open.filter((row) => row.paymentStatus === 'paid')) {
      await Doctor.updateOne(
        { _id: c.doctorId, totalConsultations: { $gt: 0 } },
        { $inc: { totalConsultations: -1 } },
      );
    }
  }
  await safeEarningHook('cancelled', () =>
    reverseConsultationEarnings(
      open.map((c) => c._id),
      'Cancelled: patient deleted their account',
    ),
  );
  for (const consultation of open) {
    if (consultation.paymentStatus === 'paid') {
      logger.warn('consultation_refund_required', {
        action: 'consultation_refund_required',
        consultationId: String(consultation._id),
        doctorId: String(consultation.doctorId),
        patientId: String(userId),
        amountPaid: consultation.amountPaid,
        currency: consultation.currency,
        cashfreeOrderId: consultation.cashfreeOrderId,
        reason,
      });
    }
  }
  return open.length;
};

/** Pending workspace approvals raised by this account must not be approved
 * (and replayed as them) after they've lost access. */
export const cancelPendingChangeRequests = (userId, note) =>
  ChangeRequest.updateMany(
    { requestedBy: userId, status: 'pending' },
    { status: 'cancelled', reviewNote: note, reviewedAt: new Date() },
  );

/** No more pushes, reminders, or outbound check-in calls. */
const silenceAccount = async (userId) => {
  await User.updateOne({ _id: userId }, { $unset: { notificationToken: 1 } });
  await CycleSettings.updateMany(
    { userId },
    {
      checkinCallEnabled: false,
      remindersEnabled: false,
      ovulationReminder: false,
      fertilityReminder: false,
    },
  );
};

const toObjectId = (id) => (typeof id === 'string' ? new mongoose.Types.ObjectId(id) : id);

/** Everything other people can see or that keeps running against the account. */
const teardownForRemoval = async (user, { reason, dropReports = false }) => {
  const userId = user._id;
  disconnectUser(userId);
  await silenceAccount(userId);
  await severPartnerLinks(userId);
  await endBuddyMatches(userId);
  await leaveAllCircles(userId);
  await removeNominations(userId);
  await scrubCommunityFootprint(userId, { dropReports });
  await cancelPendingChangeRequests(userId, 'Requester account was deleted');
  await cancelPatientConsultations(userId, { reason });
  if (user.role === userRoleEnum.DOCTOR) {
    await retireDoctorProfiles({ userId }, { reason });
  }
};

/* --------------------------------------------------------------------------
 * Entry points
 * ------------------------------------------------------------------------ */

/**
 * In-app account deletion. `user` is a loaded User document. Idempotent: an
 * already-deleted account just re-runs the (no-op) teardown.
 */
export const softDeleteAccount = async (user) => {
  user.isActive = false;
  user.deletedAt = user.deletedAt || new Date();
  if (!String(user.email).startsWith('deleted_')) {
    user.email = deletedEmailFor(user._id, user.email);
  }
  // Frees the Google account for a fresh signup; the purge finds this row by
  // its original email instead (see findAccountsByOriginalEmail).
  user.googleId = undefined;
  user.notificationToken = undefined;
  user.inviteTokenHash = undefined;
  user.inviteTokenExpiresAt = undefined;
  user.$locals.skipPasswordHash = true;
  await user.save();

  await revokeAllSessions(user._id, 'account_deleted');
  await teardownForRemoval(user, { reason: 'account_deleted' });
  logger.info('account_soft_deleted', { action: 'account_soft_deleted', userId: String(user._id) });
};

/** Admin suspension (reversible). */
export const suspendAccount = async (user) => {
  await revokeAllSessions(user._id, 'account_suspended');
  disconnectUser(user._id);
  // A pairing with a locked account is dead weight for the other member,
  // who can't start a new one while it exists; it's disposable by design.
  await endBuddyMatches(user._id);
  await cancelPendingChangeRequests(user._id, 'Requester account was suspended');
  logger.info('account_suspended_teardown', {
    action: 'account_suspended_teardown',
    userId: String(user._id),
  });
};

/**
 * All accounts whose owner signed up with `email` — the live one and any
 * soft-deleted ones (renamed to `deleted_<id>_<email>`).
 */
export const findAccountsByOriginalEmail = (email, select = '') => {
  const escaped = String(email).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return User.find({
    $or: [{ email }, { email: { $regex: `^deleted_[0-9a-f]{24}_${escaped}$` } }],
  }).select(select);
};

/** Public self-service erasure. Irreversible. */
export const purgeAccount = async (userId) => {
  const user = await User.findById(userId);
  if (!user) return;
  const email = originalEmailOf(user);

  await revokeAllSessions(user._id, 'account_purged');
  await teardownForRemoval(user, { reason: 'account_purged', dropReports: true });

  // Files first — once the Document rows are gone we can't find their keys.
  const documents = await Document.find({ userId }).select('fileKey').lean();
  await Promise.all(documents.map((doc) => deleteFromS3(doc.fileKey)));
  await deleteS3Prefix(`medical-documents/${userId}/`);
  await deleteS3Prefix(`users/${userId}/`);

  const [consultations, partnerRows] = await Promise.all([
    Consultation.find({ userId }).select('paymentStatus').lean(),
    Partner.find({ userId }).select('_id').lean(),
  ]);
  const consultationIds = consultations.map((c) => c._id);
  // Kept for the doctor's earnings and the payment trail, emptied of content.
  const paidIds = consultations
    .filter((c) => ['paid', 'refunded'].includes(c.paymentStatus))
    .map((c) => c._id);
  const unpaidIds = consultationIds.filter((id) => !paidIds.some((p) => String(p) === String(id)));

  await Promise.all([
    CycleLog.deleteMany({ userId }),
    CycleSettings.deleteMany({ userId }),
    CheckinCall.deleteMany({ userId }),
    Habit.deleteMany({ userId }),
    HabitCompletion.deleteMany({ userId }),
    HabitSuggestionDay.deleteMany({ userId }),
    ForestLog.deleteMany({ userId }),
    ForestGarden.deleteMany({ userId }),
    ConsultationMessage.deleteMany({ consultationId: { $in: consultationIds } }),
    Consultation.deleteMany({ _id: { $in: unpaidIds } }),
    Consultation.updateMany(
      { _id: { $in: paidIds } },
      {
        $set: { messages: [] },
        $unset: { prescription: 1, feedback: 1, meetingLink: 1, videoRoom: 1, videoAttendance: 1 },
      },
    ),
    CommunityPost.deleteMany({ userId }),
    CommunityLike.deleteMany({ userId }),
    Comment.deleteMany({ userId }),
    // Normally already gone (scrubReelFootprint above moves the counters too).
    ReelLike.deleteMany({ userId }),
    ReelSave.deleteMany({ userId }),
    ReelComment.deleteMany({ userId }),
    Document.deleteMany({ userId }),
    DocumentChatMessage.deleteMany({ userId }),
    Notification.deleteMany({ userId }),
    RewardTransaction.deleteMany({ userId }),
    ScreeningAssessment.deleteMany({ userId }),
    UserSession.deleteMany({ userId }),
    LaunchInterest.deleteMany({ user: userId }),
    QaChatSession.deleteMany({ userId }),
    SupportTicket.deleteMany({ userId }),
    SymptomRecord.deleteMany({ userId }),
    BlogReader.deleteMany({ userId }),
    SchemeApplication.deleteMany({ userId }),
    PartnerMessage.deleteMany({ partnerId: { $in: partnerRows.map((row) => row._id) } }),
    Partner.deleteMany({ userId }),
    Newsletter.deleteMany({ email }),
    ContactMessage.deleteMany({ email }),
    PendingSignup.deleteMany({ email }),
  ]);

  // Entitlement / CouponRedemption rows are kept as payment records; they
  // only hold the (now dangling) user id, no personal data.
  await User.deleteOne({ _id: userId });
  logger.info('account_purged', { action: 'account_purged', userId: String(userId) });
};

/**
 * Accounts deleted before `deletedAt` existed only have the renamed email,
 * and nothing linked to them was ever torn down. Runs once per such account
 * at startup (seeder.js); marking `deletedAt` first makes it one-shot.
 */
export const backfillLegacyDeletedAccounts = async () => {
  const legacy = await User.find({ email: /^deleted_/, deletedAt: null });
  for (const user of legacy) {
    try {
      user.deletedAt = user.updatedAt || new Date();
      await softDeleteAccount(user);
    } catch (error) {
      logger.error('legacy_deleted_account_backfill_failed', {
        action: 'legacy_deleted_account_backfill_failed',
        userId: String(user._id),
        error: error.message,
      });
    }
  }
  if (legacy.length > 0) {
    logger.info('legacy_deleted_accounts_backfilled', {
      action: 'legacy_deleted_accounts_backfilled',
      count: legacy.length,
    });
  }
};
