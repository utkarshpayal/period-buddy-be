import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

/** PartnerMessage — message history for connected partner pairs. */
const partnerMessageSchema = new mongoose.Schema(
  {
    partnerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Partner',
      required: true,
      index: true,
    },
    sender: { type: String, enum: ['user', 'partner'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 2000 },
    sentAt: { type: Date, default: Date.now },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

partnerMessageSchema.index({ partnerId: 1, sentAt: -1 });

// Free text is encrypted at rest (utils/fieldEncryption.js).
partnerMessageSchema.plugin(encryptFields, { fields: ['text'] });

export default mongoose.model('PartnerMessage', partnerMessageSchema);
