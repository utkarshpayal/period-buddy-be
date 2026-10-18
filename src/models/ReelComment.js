import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';
import { REEL_COMMENT_MAX } from '../utils/reelSocial.js';

/**
 * ReelComment: a comment on a reel, shown with the author's name and photo.
 * `text` is encrypted at rest (people write about their own health under
 * health videos), so it can't be searched or sorted in the database.
 *
 * Paging is by `_id` (newest first). `Reel.commentCount` counts visible
 * comments only: it goes down when a comment is deleted or auto-hidden after
 * REEL_COMMENT_REPORT_HIDE_AT reports (utils/reelSocial.js).
 */
const reelCommentSchema = new mongoose.Schema(
  {
    reelId: { type: mongoose.Schema.Types.ObjectId, ref: 'Reel', required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: REEL_COMMENT_MAX },
    isHidden: { type: Boolean, default: false },
    reportCount: { type: Number, default: 0, min: 0 },
    // Who reported it, so one person counts once. Never sent to the app.
    reportedBy: { type: [{ type: mongoose.Schema.Types.ObjectId, ref: 'User' }], select: false },
  },
  { timestamps: true },
);

reelCommentSchema.index({ reelId: 1, isHidden: 1, _id: -1 });

reelCommentSchema.plugin(encryptFields, { fields: ['text'] });

export default mongoose.model('ReelComment', reelCommentSchema);
