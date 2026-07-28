import mongoose from 'mongoose';

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
    feedback: { type: String, trim: true },

    razorpayOrderId: { type: String, index: true },
    razorpayPaymentId: { type: String },

    startedAt: { type: Date },
    completedAt: { type: Date },

    /** @deprecated use ConsultationMessage collection */
    messages: { type: Array, default: [] },
  },
  { timestamps: true },
);

consultationSchema.index({ userId: 1, doctorId: 1 });
consultationSchema.index({ userId: 1, status: 1 });

export default mongoose.model('Consultation', consultationSchema);
