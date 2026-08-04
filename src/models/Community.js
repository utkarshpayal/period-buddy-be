import mongoose from 'mongoose';

const communityCommentSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    isAnonymous: { type: Boolean, default: false },
    attachments: [
      {
        url: { type: String, required: true, trim: true },
        key: { type: String, trim: true },
        type: { type: String, enum: ['image', 'video', 'audio'], required: true },
        _id: false,
      },
    ],
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

const communityPostSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    title: { type: String, trim: true, maxlength: 200 },
    content: { type: String, required: true, trim: true, maxlength: 5000 },
    category: {
      type: String,
      enum: [
        'general',
        'symptoms',
        'advice',
        'success_story',
        'question',
        'rant',
        'PCOS',
        'Fitness',
        'Skin',
      ],
      default: 'general',
    },
    tags: [{ type: String, trim: true }],
    isAnonymous: { type: Boolean, default: true },

    attachments: [
      {
        url: { type: String, required: true, trim: true },
        key: { type: String, trim: true },
        type: { type: String, enum: ['image', 'video', 'audio'], required: true },
        _id: false,
      },
    ],

    // Denormalized counters (sources of truth live in CommunityLike / Comment collections)
    likeCount: { type: Number, default: 0 },
    commentCount: { type: Number, default: 0 },
    reportCount: { type: Number, default: 0 },

    // Moderation
    status: {
      type: String,
      enum: ['active', 'flagged', 'removed'],
      default: 'active',
    },
    isActive: { type: Boolean, default: true },

    // Kept for backward compat with existing controllers
    /** @deprecated query CommunityLike collection */
    likedBy: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }],
    comments: [communityCommentSchema],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

communityPostSchema.index({ isActive: 1, status: 1, createdAt: -1 });
communityPostSchema.index({ category: 1, createdAt: -1 });
communityPostSchema.index({ userId: 1, createdAt: -1 });

communityPostSchema
  .virtual('likes')
  .get(function () {
    return this.likeCount;
  })
  .set(function (val) {
    this.likeCount = val;
  });

export default mongoose.model('CommunityPost', communityPostSchema);
