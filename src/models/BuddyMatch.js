import mongoose from 'mongoose';

const buddyMatchSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    buddyUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    matchKey: { type: String, required: true, trim: true },
    // Unique per pairing (both sides of a real-user match share the same value) so a
    // WebSocket room can never be reused by a later, unrelated pairing — unlike matchKey,
    // which is just the counterpart's userId and gets reused if that person is later
    // matched with someone else, letting a stale ex-buddy's socket bleed into a new pairing.
    roomKey: { type: String, required: true, trim: true, index: true },
    alias: { type: String, required: true, trim: true },
    avatarSeed: { type: String, required: true, trim: true },
    cyclePhase: { type: String, trim: true },
    cycleOverlapDays: { type: Number, default: 0 },
    compatibility: { type: Number, min: 0, max: 100, default: 80 },
    similarities: [{ type: String, trim: true }],
    status: {
      type: String,
      enum: ['active', 'ended'],
      default: 'active',
      index: true,
    },

    // Messaging summary (BuddyMessage is now the canonical collection)
    lastMessage: { type: String, trim: true },
    lastMessageAt: { type: Date },
    unreadCount: { type: Number, default: 0, min: 0 },

    nominatedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },

    /** @deprecated use BuddyMessage collection */
    messages: { type: Array, default: [] },
  },
  { timestamps: true },
);

buddyMatchSchema.index({ userId: 1, status: 1 });
buddyMatchSchema.index({ userId: 1, matchKey: 1, status: 1 }, { unique: true });

export default mongoose.model('BuddyMatch', buddyMatchSchema);
