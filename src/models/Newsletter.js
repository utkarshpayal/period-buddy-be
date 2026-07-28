import mongoose from 'mongoose';

const newsletterSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    isActive: { type: Boolean, default: true },
    source: { type: String, default: 'marketing_website' },
    unsubscribedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

newsletterSchema.index({ isActive: 1 });

export default mongoose.model('Newsletter', newsletterSchema);
