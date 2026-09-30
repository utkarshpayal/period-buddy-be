import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

const documentChatMessageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true },
);

documentChatMessageSchema.index({ userId: 1, createdAt: 1 });

// Free text is encrypted at rest (utils/fieldEncryption.js).
documentChatMessageSchema.plugin(encryptFields, { fields: ['text'] });

export default mongoose.model('DocumentChatMessage', documentChatMessageSchema);
