import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

const consultationSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Doctor',
      required: true,
    },
    status: {
      type: String,
      enum: ['pending', 'paid', 'active', 'completed', 'cancelled'],
      default: 'pending',
    },
    amountPaid: { type: Number },
    currency: { type: String, default: 'USD' },

    // New production fields
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded', 'failed'],
      default: 'unpaid',
    },
    meetingLink: { type: String, trim: true },
    prescription: { type: String, trim: true },
    // The patient's rating of a completed session (POST /api/consultation/:id/rating),
    // once only; `feedback` is its optional comment (encrypted, see below).
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String, trim: true, maxlength: 500 },
    ratedAt: { type: Date },

    cashfreeOrderId: { type: String, index: true },

    startedAt: { type: Date },
    completedAt: { type: Date },

    /** @deprecated use ConsultationMessage collection */
    messages: { type: Array, default: [] },
  },
  { timestamps: true },
);

consultationSchema.index({ userId: 1, doctorId: 1 });
consultationSchema.index({ userId: 1, status: 1 });
// Doctor portal's paginated bookings list (GET /api/doctor/consultations).
consultationSchema.index({ doctorId: 1, createdAt: -1 });

consultationSchema.plugin(encryptFields, { fields: ['feedback'] });

export default mongoose.model('Consultation', consultationSchema);
