import mongoose from 'mongoose';

const documentChatMessageSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    role: { type: String, enum: ['user', 'assistant'], required: true },
    text: { type: String, required: true, trim: true, maxlength: 4000 },
  },
  { timestamps: true },
);

documentChatMessageSchema.index({ userId: 1, createdAt: 1 });

export default mongoose.model('DocumentChatMessage', documentChatMessageSchema);
