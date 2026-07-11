import mongoose from 'mongoose';

const pollOptionSchema = new mongoose.Schema(
  {
    optionId: { type: String, required: true, trim: true },
    topic: { type: String, required: true, trim: true },
    votes: { type: Number, default: 0, min: 0 },
  },
  { _id: false }
);

const reelVoteSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    optionId: { type: String, required: true, trim: true },
    votedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reelSchema = new mongoose.Schema(
  {
    title: { type: String, required: true, trim: true, maxlength: 180 },
    creatorId: { type: String, required: true, trim: true, index: true },
    creatorName: { type: String, required: true, trim: true },
    creatorAvatar: { type: String, trim: true },
    duration: { type: String, trim: true },
    category: { type: String, trim: true, default: 'Wellness', index: true },
    verified: { type: Boolean, default: true },
    thumbnailUrl: { type: String, required: true, trim: true },
    directMp4Url: { type: String, required: true, trim: true },
    pollQuestion: { type: String, trim: true },
    pollOptions: [pollOptionSchema],
    votes: [reelVoteSchema],
    followedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    views: { type: Number, default: 0, min: 0 },
    likes: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true, index: true },
    publishedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

reelSchema.index({ isActive: 1, publishedAt: -1 });
reelSchema.index({ title: 'text', creatorName: 'text', category: 'text' });

export default mongoose.model('Reel', reelSchema);
