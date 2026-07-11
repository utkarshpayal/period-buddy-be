import mongoose from 'mongoose';

const messageSchema = new mongoose.Schema({
  sender: { type: String, enum: ['user', 'doctor'], required: true },
  text: { type: String, required: true, trim: true },
  sentAt: { type: Date, default: Date.now },
});

const consultationSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    status: { type: String, enum: ['pending', 'paid', 'active', 'completed', 'cancelled'], default: 'pending' },
    amountPaid: { type: Number },
    currency: { type: String, default: 'USD' },
    messages: [messageSchema],
    startedAt: { type: Date },
    completedAt: { type: Date },
  },
  { timestamps: true }
);

consultationSchema.index({ userId: 1, doctorId: 1 });

export default mongoose.model('Consultation', consultationSchema);
