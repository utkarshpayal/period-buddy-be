import mongoose from 'mongoose';

const buddyMessageSchema = new mongoose.Schema(
  {
    sender: { type: String, enum: ['me', 'buddy'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    sentAt: { type: Date, default: Date.now },
  },
  { _id: true }
);

const buddyMatchSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    buddyUserId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    matchKey: { type: String, required: true, trim: true },
    alias: { type: String, required: true, trim: true },
    avatarSeed: { type: String, required: true, trim: true },
    cyclePhase: { type: String, trim: true },
    cycleOverlapDays: { type: Number, default: 0 },
    compatibility: { type: Number, min: 0, max: 100, default: 80 },
    similarities: [{ type: String, trim: true }],
    status: { type: String, enum: ['active', 'ended'], default: 'active', index: true },
    nominatedAt: { type: Date, default: Date.now },
    endedAt: { type: Date },
    messages: [buddyMessageSchema],
  },
  { timestamps: true }
);

buddyMatchSchema.index({ userId: 1, status: 1 });
buddyMatchSchema.index({ userId: 1, matchKey: 1, status: 1 }, { unique: true });

export default mongoose.model('BuddyMatch', buddyMatchSchema);
