import mongoose from 'mongoose';

const partnerSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      unique: true,
    },
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    inviteCode: { type: String, unique: true, sparse: true },
    inviteCodeExpiry: { type: Date },
    isConnected: { type: Boolean, default: false },
    // 'owner' = this account's data is what gets shared (they generated the invite code).
    // 'viewer' = this account connected using someone else's code and only sees shared data.
    role: { type: String, enum: ['owner', 'viewer', null], default: null },
    connectedAt: { type: Date },
    permissions: {
      shareCyclePhase: { type: Boolean, default: true },
      shareSymptoms: { type: Boolean, default: false },
      shareIntimacyLog: { type: Boolean, default: false },
      shareAlerts: { type: Boolean, default: true },
    },

    // New production fields
    connectionStatus: {
      type: String,
      enum: ['pending', 'connected', 'disconnected'],
      default: 'pending',
    },
    blocked: { type: Boolean, default: false },
    lastSeen: { type: Date },

    /** @deprecated use PartnerMessage collection */
    messages: { type: Array, default: [] },
  },
  { timestamps: true }
);

partnerSchema.index({ inviteCode: 1 });
partnerSchema.index({ partnerId: 1 });

export default mongoose.model('Partner', partnerSchema);
