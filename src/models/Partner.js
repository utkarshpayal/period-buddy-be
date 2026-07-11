import mongoose from 'mongoose';

const partnerMessageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'partner'], required: true },
  text: { type: String, required: true, trim: true },
  sentAt: { type: Date, default: Date.now },
});

const partnerSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    partnerId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    inviteCode: { type: String, unique: true, sparse: true },
    inviteCodeExpiry: { type: Date },
    isConnected: { type: Boolean, default: false },
    connectedAt: { type: Date },
    permissions: {
      shareCyclePhase: { type: Boolean, default: true },
      shareSymptoms: { type: Boolean, default: false },
      shareIntimacyLog: { type: Boolean, default: true },
      shareAlerts: { type: Boolean, default: true },
    },
    messages: [partnerMessageSchema],
  },
  { timestamps: true }
);

partnerSchema.index({ inviteCode: 1 });

export default mongoose.model('Partner', partnerSchema);
