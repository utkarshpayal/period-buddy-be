import mongoose from 'mongoose';

/**
 * RewardTransaction — ledger for all wallet credit/debit events.
 * Replaces the raw tokensEarned / walletBalance increment pattern.
 */
const rewardTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    amount: { type: Number, required: true }, // positive = credit, negative = debit
    type: {
      type: String,
      enum: [
        'cycle_log',
        'habit_complete',
        'forest_care',
        'qa_ask',
        'community_post',
        'community_like',
        'content_read',
        'reel_vote',
        'buddy_message',
        'referral',
        'streak_bonus',
        'purchase',
        'redemption',
        'adjustment',
      ],
      required: true,
    },
    description: { type: String, trim: true },
    referenceId: { type: mongoose.Schema.Types.ObjectId }, // linked document id
    referenceModel: { type: String, trim: true }, // model name
    balanceAfter: { type: Number, required: true },
  },
  { timestamps: true },
);

rewardTransactionSchema.index({ userId: 1, createdAt: -1 });
rewardTransactionSchema.index({ userId: 1, type: 1 });

export default mongoose.model('RewardTransaction', rewardTransactionSchema);
