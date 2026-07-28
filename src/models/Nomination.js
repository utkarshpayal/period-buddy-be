import mongoose from 'mongoose';

const nominationSchema = new mongoose.Schema(
  {
    nominatorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    nomineeEmail: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    nomineeName: { type: String, trim: true },
    message: { type: String, trim: true, maxlength: 500 },
    status: {
      type: String,
      enum: ['pending', 'accepted', 'declined'],
      default: 'pending',
    },
    nomineeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },

    // New production fields
    inviteCode: { type: String, trim: true, unique: true, sparse: true },
    expiresAt: { type: Date },
    acceptedAt: { type: Date },
    rejectedAt: { type: Date },
  },
  { timestamps: true },
);

nominationSchema.index({ nominatorId: 1, nomineeEmail: 1 }, { unique: true });
nominationSchema.index({ inviteCode: 1 });

export default mongoose.model('Nomination', nominationSchema);
