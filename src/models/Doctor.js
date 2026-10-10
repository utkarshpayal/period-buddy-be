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
    // Average of patients' session ratings, kept in step by
    // recomputeDoctorRating (consultationController). Only meaningful once
    // ratingCount > 0; clients show "New" before that.
    rating: { type: Number, default: 4.5, min: 1, max: 5 },
    ratingCount: { type: Number, default: 0 },
    pricePerSession: { type: Number, required: true },
    // INR only for now; controllers force it (wallet totals are INR).
    currency: { type: String, default: 'INR' },
    /** @deprecated replaced by avatarUrl; kept for app builds that still read it. */
    avatarEmoji: { type: String, default: '👩‍⚕️' },
    /** Profile photo shown to patients (public S3 URL under doctors/<id>/avatar). */
    avatarUrl: { type: String, trim: true },
    /** S3 key of avatarUrl, so a replaced or removed photo can be deleted. */
    avatarKey: { type: String, select: false },
    bio: { type: String, trim: true },
    languages: [{ type: String }],

    // New production fields
    experience: { type: String, trim: true }, // e.g. '10 years'
    education: [{ type: String, trim: true }],
    licenses: [{ type: String, trim: true }],
    hospital: { type: String, trim: true },

    isAvailable: { type: Boolean, default: true },

    /** Booking rules the doctor sets on the portal's Availability page:
     * how many days ahead patients can book, and the minimum notice. */
    bookingWindowDays: { type: Number, default: 14, min: 1, max: 90 },
    minNoticeMinutes: { type: Number, default: 15, min: 0, max: 7 * 24 * 60 },
    /** Length of one consultation; every range is cut into slots this long.
     * Unset for doctors who haven't saved since it existed. */
    consultationMinutes: { type: Number, min: 10, max: 240 },

    /** Platform commission override in basis points (1% = 100). null = the
     * Clinical Admin's default (ClinicalPayoutSettings.defaultCommissionBps).
     * select: false, since the patient app lists Doctor docs as-is; read it
     * with .select('+commissionBps'). */
    commissionBps: { type: Number, default: null, min: 0, max: 10_000, select: false },

    totalConsultations: { type: Number, default: 0 },

    /** Set when an admin deletes the doctor for good (deleteDoctorAccount).
     * The row stays for earnings and consultation history; lists hide it. */
    deletedAt: { type: Date, default: null },

    /** @deprecated availability is now managed by DoctorAvailability collection */
    availability: { type: String, default: 'Available today' },
  },
  { timestamps: true },
);

doctorSchema.index({ isAvailable: 1, rating: -1 });

export default mongoose.model('Doctor', doctorSchema);
