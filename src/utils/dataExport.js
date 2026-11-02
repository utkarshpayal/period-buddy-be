import User from '../models/User.js';
import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import CheckinCall from '../models/CheckinCall.js';
import Habit from '../models/Habit.js';
import HabitCompletion from '../models/HabitCompletion.js';
import ForestGarden from '../models/ForestGarden.js';
import ForestLog from '../models/ForestLog.js';
import Consultation from '../models/Consultation.js';
import ConsultationMessage from '../models/ConsultationMessage.js';
import Document from '../models/Document.js';
import DocumentChatMessage from '../models/DocumentChatMessage.js';
import Notification from '../models/Notification.js';
import RewardTransaction from '../models/RewardTransaction.js';
import ScreeningAssessment from '../models/ScreeningAssessment.js';
import QaChatSession from '../models/QaChatSession.js';
import SupportTicket from '../models/SupportTicket.js';
import SymptomRecord from '../models/SymptomRecord.js';
import BlogReader from '../models/BlogReader.js';
import SchemeApplication from '../models/SchemeApplication.js';
import Partner from '../models/Partner.js';
import PartnerMessage from '../models/PartnerMessage.js';
import BuddyMessage from '../models/BuddyMessage.js';
import CommunityPost from '../models/Community.js';
import Comment from '../models/Comment.js';
import ReelLike from '../models/ReelLike.js';
import ReelSave from '../models/ReelSave.js';
import ReelComment from '../models/ReelComment.js';
import LaunchInterest from '../models/LaunchInterest.js';
import { getSignedViewUrl } from './s3.js';
import { listSessions } from './sessions.js';

/**
 * Everything the app stores about one person, for "Download my data" (the
 * right of access). Mirrors what purgeAccount (utils/accountLifecycle.js)
 * erases: add a collection to both.
 *
 * Health text arrives decrypted (the models' encryptFields plugin). Left
 * out: secrets (password hash, one-time codes, push token, Google id), file
 * storage keys (documents come with a one-hour download link instead), and
 * other people's messages in buddy chats, which aren't this person's data.
 */

// Internal fields nobody needs in their export.
const strip = ({ __v, ...row }) => row;
const all = (rows) => rows.map(strip);

export const buildDataExport = async (userId) => {
  const user = await User.findById(userId).lean();
  if (!user) return null;
  const {
    password: _p,
    notificationToken: _n,
    webPushTokens: _w,
    googleId: _g,
    sessionsRevokedAt: _s,
    __v,
    ...profile
  } = user;

  const [consultations, partners, documents] = await Promise.all([
    Consultation.find({ userId }).lean(),
    Partner.find({ userId }).lean(),
    Document.find({ userId }).lean(),
  ]);

  const [
    cycleSettings,
    cycleLogs,
    checkinCalls,
    habits,
    habitCompletions,
    forest,
    consultationMessages,
    documentChats,
    notifications,
    rewards,
    screenings,
    aiChats,
    schemeApplications,
    partnerMessages,
    buddyMessages,
    posts,
    comments,
    waitlists,
    supportTickets,
    symptomRecords,
    forestGarden,
    blogReads,
    reelLikes,
    reelSaves,
    reelComments,
    sessions,
  ] = await Promise.all([
    CycleSettings.find({ userId }).lean(),
    CycleLog.find({ userId }).sort({ dateKey: 1 }).lean(),
    CheckinCall.find({ userId }).sort({ createdAt: 1 }).lean(),
    Habit.find({ userId }).lean(),
    HabitCompletion.find({ userId }).lean(),
    ForestLog.find({ userId }).lean(),
    ConsultationMessage.find({ consultationId: { $in: consultations.map((c) => c._id) } })
      .sort({ sentAt: 1 })
      .lean(),
    DocumentChatMessage.find({ userId }).sort({ createdAt: 1 }).lean(),
    Notification.find({ userId }).sort({ createdAt: 1 }).lean(),
    RewardTransaction.find({ userId }).sort({ createdAt: 1 }).lean(),
    ScreeningAssessment.find({ userId }).sort({ createdAt: 1 }).lean(),
    QaChatSession.find({ userId }).sort({ createdAt: 1 }).lean(),
    SchemeApplication.find({ userId }).lean(),
    PartnerMessage.find({ partnerId: { $in: partners.map((p) => p._id) } })
      .sort({ sentAt: 1 })
      .lean(),
    BuddyMessage.find({ senderId: userId }).sort({ sentAt: 1 }).lean(),
    CommunityPost.find({ userId }).sort({ createdAt: 1 }).lean(),
    Comment.find({ userId }).sort({ createdAt: 1 }).lean(),
    LaunchInterest.find({ user: userId }).lean(),
    SupportTicket.find({ userId })
      .select('-assignee -replies.authorId -adminEmailDelivered')
      .sort({ createdAt: 1 })
      .lean(),
    SymptomRecord.find({ userId }).select('-userId').sort({ onsetDate: 1 }).lean(),
    ForestGarden.find({ userId }).select('-userId').lean(),
    BlogReader.find({ userId }).select('-userId').lean(),
    ReelLike.find({ userId }).select('-userId').sort({ createdAt: 1 }).lean(),
    ReelSave.find({ userId }).select('-userId').sort({ createdAt: 1 }).lean(),
    ReelComment.find({ userId }).select('-userId').sort({ createdAt: 1 }).lean(),
    listSessions(userId),
  ]);

  const documentsOut = await Promise.all(
    documents.map(async ({ fileKey, fileUrl: _u, __v: _v, ...doc }) => ({
      ...doc,
      downloadUrl: await getSignedViewUrl({ key: fileKey, expiresIn: 3600 }),
    })),
  );

  return {
    exportedAt: new Date().toISOString(),
    format: 'The Nura data export v1',
    notes:
      'Everything The Nura stores about you. Document download links expire one hour after this export was made.',
    profile,
    cycle: { settings: all(cycleSettings), logs: all(cycleLogs) },
    habits: { habits: all(habits), completions: all(habitCompletions) },
    forest: all(forest),
    forestGarden: all(forestGarden),
    rewards: all(rewards),
    documents: { files: documentsOut, chats: all(documentChats) },
    aiChats: all(aiChats),
    screenings: all(screenings),
    consultations: { consultations: all(consultations), messages: all(consultationMessages) },
    checkinCalls: all(checkinCalls),
    partner: { links: all(partners), messages: all(partnerMessages) },
    buddyMessagesYouSent: all(buddyMessages),
    community: { posts: all(posts), comments: all(comments) },
    schemeApplications: all(schemeApplications),
    notifyMeLists: all(waitlists),
    notifications: all(notifications),
    supportTickets: all(supportTickets),
    bodyMapSymptoms: all(symptomRecords),
    blogReads: all(blogReads),
    reels: { likes: all(reelLikes), saves: all(reelSaves), comments: all(reelComments) },
    signedInDevices: sessions,
  };
};
