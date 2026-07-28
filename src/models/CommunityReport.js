import mongoose from 'mongoose';

/** CommunityReport — abuse reports for posts and comments. */
const communityReportSchema = new mongoose.Schema(
  {
    reportedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    targetType: {
      type: String,
      enum: ['post', 'comment'],
      required: true,
    },
    targetId: {
      type: mongoose.Schema.Types.ObjectId,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      enum: ['spam', 'harassment', 'misinformation', 'inappropriate', 'other'],
      required: true,
    },
    details: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['pending', 'reviewed', 'actioned', 'dismissed'],
      default: 'pending',
    },
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt: { type: Date },
  },
  { timestamps: true },
);

communityReportSchema.index({ targetType: 1, targetId: 1, reportedBy: 1 }, { unique: true });
communityReportSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('CommunityReport', communityReportSchema);
