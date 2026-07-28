import mongoose from 'mongoose';

const contactMessageSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, trim: true, lowercase: true },
    topic: {
      type: String,
      trim: true,
      default: 'General question',
      enum: [
        'General question',
        'Privacy & data',
        'Bug report',
        'Partnership / press',
        'Billing (Nura Plus)',
      ],
    },
    message: { type: String, required: true, trim: true },
    status: { type: String, enum: ['new', 'read', 'resolved'], default: 'new' },
    emailDelivered: { type: Boolean, default: false },
  },
  { timestamps: true },
);

contactMessageSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('ContactMessage', contactMessageSchema);
