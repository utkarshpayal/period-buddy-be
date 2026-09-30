import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

// A single Nura Companion chat session. Messages are embedded rather than a
// separate collection — sessions are short-lived, per-user conversations
// (not a huge shared log like DocumentChatMessage), so keeping the whole
// thread on one document keeps "list history" and "open a session" each a
// single read.
const chatMessageSchema = new mongoose.Schema(
  {
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
    source: { type: String },
    personalized: { type: Boolean, default: false },
    disclaimer: { type: String },
    suggestedQuestions: [{ type: String }],
  },
  { timestamps: true },
);

export const CHAT_TOPIC_IDS = [
  'cycle',
  'symptoms',
  'hygiene',
  'mood',
  'partner',
  'nutrition',
  'general',
];

const qaChatSessionSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // 'general' when started from the plain "Ask anything" input rather than
    // a topic chip — the AI answers without topic scoping in that case.
    topicId: { type: String, enum: CHAT_TOPIC_IDS, default: 'general' },
    topicLabel: { type: String, default: 'Other' },
    // Auto-set from the first user message so the history list has
    // something more useful than "General" to show per row.
    title: { type: String, trim: true, maxlength: 140 },
    messages: [chatMessageSchema],
    lastMessageAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

qaChatSessionSchema.index({ userId: 1, lastMessageAt: -1 });

// Free text is encrypted at rest (utils/fieldEncryption.js).
qaChatSessionSchema.plugin(encryptFields, { fields: ['title', 'messages.text'] });

export default mongoose.model('QaChatSession', qaChatSessionSchema);
