import mongoose from 'mongoose';

/** BuddyMessage — message history for active buddy pairs. */
const buddyMessageSchema = new mongoose.Schema(
  {
    matchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'BuddyMatch',
      required: true,
      index: true,
    },
    sender: { type: String, enum: ['me', 'buddy'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    sentAt: { type: Date, default: Date.now },
    readAt: { type: Date, default: null },
  },
  { timestamps: true }
);

buddyMessageSchema.index({ matchId: 1, sentAt: -1 });

export default mongoose.model('BuddyMessage', buddyMessageSchema);
