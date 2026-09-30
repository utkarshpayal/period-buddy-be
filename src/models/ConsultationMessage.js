import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

/** ConsultationMessage — message history for consultations. */
const consultationMessageSchema = new mongoose.Schema(
  {
    consultationId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Consultation',
      required: true,
      index: true,
    },
    sender: { type: String, enum: ['user', 'doctor'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 3000 },
    attachmentUrl: { type: String, trim: true },
    sentAt: { type: Date, default: Date.now },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

consultationMessageSchema.index({ consultationId: 1, sentAt: -1 });

// Free text is encrypted at rest (utils/fieldEncryption.js).
consultationMessageSchema.plugin(encryptFields, { fields: ['text'] });

export default mongoose.model('ConsultationMessage', consultationMessageSchema);
