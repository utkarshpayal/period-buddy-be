import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';
import {
  MESSAGE_MAX,
  REPLY_MAX,
  SUBJECT_MAX,
  SUPPORT_CATEGORY_IDS,
  TICKET_PRIORITIES,
  TICKET_STATUSES,
  formatTicketNumber,
} from '../utils/supportTicket.js';

/**
 * Help & support ticket raised from the app (Profile → Help & support).
 * Subject, message and reply text are encrypted at rest, so admin search
 * works on the ticket number and the person's name/email, never the text.
 * Pure rules live in utils/supportTicket.js.
 */
const replySchema = new mongoose.Schema(
  {
    from: { type: String, enum: ['user', 'admin'], required: true },
    // Staff member who wrote an admin reply (not exposed to the app).
    authorId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    message: { type: String, required: true, trim: true, maxlength: REPLY_MAX },
    at: { type: Date, default: Date.now },
  },
  { _id: true },
);

const supportTicketSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    ticketNumber: { type: String, required: true, unique: true },
    category: { type: String, enum: SUPPORT_CATEGORY_IDS, required: true },
    subject: { type: String, required: true, trim: true, maxlength: SUBJECT_MAX },
    message: { type: String, required: true, trim: true, maxlength: MESSAGE_MAX },
    status: { type: String, enum: TICKET_STATUSES, default: 'open', index: true },
    priority: { type: String, enum: TICKET_PRIORITIES, default: 'normal' },
    assignee: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    replies: [replySchema],
    // Only when the person switched on "attach app info".
    meta: {
      platform: String,
      osVersion: String,
      appVersion: String,
      deviceModel: String,
      buildNumber: String,
      locale: String,
      timezoneOffset: Number,
    },
    lastReplyFrom: { type: String, enum: ['user', 'admin'], default: 'user' },
    lastActivityAt: { type: Date, default: Date.now },
    // True after a staff reply the person hasn't opened yet.
    userUnread: { type: Boolean, default: false },
    adminEmailDelivered: { type: Boolean, default: false },
    resolvedAt: { type: Date, default: null },
    closedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

supportTicketSchema.index({ userId: 1, lastActivityAt: -1 });
supportTicketSchema.index({ status: 1, lastActivityAt: -1 });
supportTicketSchema.index({ userId: 1, createdAt: -1 });

supportTicketSchema.plugin(encryptFields, { fields: ['subject', 'message', 'replies.message'] });

/** Sequence for ticket numbers (one row, key 'support_ticket'). */
const supportCounterSchema = new mongoose.Schema({
  key: { type: String, required: true, unique: true },
  seq: { type: Number, default: 0 },
});
export const SupportCounter = mongoose.model('SupportCounter', supportCounterSchema);

/** Atomically reserve the next NURA-xxxxxx number. */
export const nextTicketNumber = async () => {
  const row = await SupportCounter.findOneAndUpdate(
    { key: 'support_ticket' },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, setDefaultsOnInsert: true },
  );
  return formatTicketNumber(row.seq);
};

export default mongoose.model('SupportTicket', supportTicketSchema);
