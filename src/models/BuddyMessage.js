import mongoose from 'mongoose';

/**
 * BuddyMessage — a single shared message stream per pairing.
 *
 * `senderId` is the absolute author of the message; each side maps it to the
 * viewer-relative "me"/"buddy" at read time. This replaces the old
 * viewer-relative `sender` string, which forced the same message to be written
 * twice (once as "me" for the sender's row, once as "buddy" for the receiver's).
 * `sender` is retained, optional, only so legacy rows still parse.
 */
const buddyMessageSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BuddyMatch',
      required: true,
      index: true,
    },
    senderId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    sentAt: { type: Date, default: Date.now },

    /** @deprecated legacy viewer-relative field; new rows use `senderId`. */
    sender: { type: String, enum: ['me', 'buddy'] },
  },
  { timestamps: true },
);

buddyMessageSchema.index({ matchId: 1, sentAt: -1 });

export default mongoose.model('BuddyMessage', buddyMessageSchema);
