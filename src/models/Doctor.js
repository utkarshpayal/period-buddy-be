import mongoose from 'mongoose';

const doctorSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    specialty: { type: String, required: true, trim: true },
    rating: { type: Number, default: 4.5, min: 1, max: 5 },
    pricePerSession: { type: Number, required: true },
    currency: { type: String, default: 'USD' },
    avatarEmoji: { type: String, default: '👩‍⚕️' },
    bio: { type: String, trim: true },
    languages: [{ type: String }],

    // New production fields
    experience: { type: String, trim: true }, // e.g. '10 years'
    education: [{ type: String, trim: true }],
    licenses: [{ type: String, trim: true }],
    hospital: { type: String, trim: true },

    isAvailable: { type: Boolean, default: true },
    totalConsultations: { type: Number, default: 0 },

    /** @deprecated availability is now managed by DoctorAvailability collection */
    availability: { type: String, default: 'Available today' },
  },
  { timestamps: true },
);

doctorSchema.index({ isAvailable: 1, rating: -1 });

export default mongoose.model('Doctor', doctorSchema);
