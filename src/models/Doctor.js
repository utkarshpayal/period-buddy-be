import mongoose from 'mongoose';

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    specialty: { type: String, required: true, trim: true },
    rating: { type: Number, default: 4.5, min: 1, max: 5 },
    availability: { type: String, default: 'Available today' },
    pricePerSession: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    avatarEmoji: { type: String, default: '👩‍⚕️' },
    bio: { type: String, trim: true },
    languages: [{ type: String }],
    isAvailable: { type: Boolean, default: true },
    totalConsultations: { type: Number, default: 0 },
  },
  { timestamps: true }
);

export default mongoose.model('Doctor', doctorSchema);
