import mongoose from 'mongoose';

const reelSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },

    // creatorId is the only creator reference; creatorName/creatorAvatar are deprecated
    creatorId: { type: String, required: true, trim: true, index: true },
    /** @deprecated resolve via creatorId User population */
    creatorName: { type: String, trim: true },
    /** @deprecated resolve via creatorId User population */
    creatorAvatar: { type: String, trim: true },

    duration: { type: String, trim: true },
    category: { type: String, trim: true, default: 'Wellness', index: true },
    verified: { type: Boolean, default: true },
    thumbnailUrl: { type: String, required: true, trim: true },
    directMp4Url: { type: String, required: true, trim: true },

    // Poll (normalised into Poll/PollOption/PollVote — kept embedded for backward compat)
    pollQuestion: { type: String, trim: true },
    pollOptions: [
      {
        optionId: { type: String, required: true, trim: true },
        topic: { type: String, required: true, trim: true },
        votes: { type: Number, default: 0, min: 0 },
        _id: false,
      },
    ],
    votes: [
      {
        userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
        optionId: { type: String, required: true, trim: true },
        votedAt: { type: Date, default: Date.now },
        _id: false,
      },
    ],
    followedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],

    // Counters — primary names
    viewCount: { type: Number, default: 0, min: 0 },
    likeCount: { type: Number, default: 0, min: 0 },
    shareCount: { type: Number, default: 0, min: 0 },
    saveCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    watchTime: { type: Number, default: 0, min: 0 }, // total seconds

    isActive: { type: Boolean, default: true, index: true },
    publishedAt: { type: Date, default: Date.now },
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  }
);

reelSchema.index({ isActive: 1, publishedAt: -1 });
reelSchema.index({ title: 'text', category: 'text' });

reelSchema.virtual('views').get(function () {
  return this.viewCount;
});

reelSchema.virtual('likes').get(function () {
  return this.likeCount;
});

export default mongoose.model('Reel', reelSchema);
