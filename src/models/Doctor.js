import mongoose from 'mongoose';

const doctorSchema = new mongoose.Schema(
  {
    // Login account backing this doctor profile. Set when a gynecologist is
    // invited from the admin panel; consultations resolve a logged-in doctor
    // User back to their Doctor profile through this link.
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      index: true,
    },
    email: { type: String, trim: true, lowercase: true, index: true },

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

    /** Platform commission override in basis points (1% = 100). null = the
     * Clinical Admin's default (ClinicalPayoutSettings.defaultCommissionBps).
     * select: false, since the patient app lists Doctor docs as-is; read it
     * with .select('+commissionBps'). */
    commissionBps: { type: Number, default: null, min: 0, max: 10_000, select: false },

    totalConsultations: { type: Number, default: 0 },

    /** @deprecated availability is now managed by DoctorAvailability collection */
    availability: { type: String, default: 'Available today' },
  },
  { timestamps: true },
);

doctorSchema.index({ isAvailable: 1, rating: -1 });

export default mongoose.model('Doctor', doctorSchema);
