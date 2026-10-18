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
    // INR only for now (see utils/doctorWallet.js WALLET_CURRENCY).
    currency: { type: String, default: 'INR' },

    // The booked slot: a UTC instant (sent as ISO 8601), shown in each
    // viewer's own time zone. `slotTimezone` is the doctor's schedule zone.
    // See utils/consultationSlots.js.
    scheduledFor: { type: Date, default: null },
    slotEndsAt: { type: Date, default: null },
    slotTimezone: { type: String, trim: true },

    // New production fields
    paymentStatus: {
      type: String,
      enum: ['unpaid', 'paid', 'refunded', 'failed'],
      default: 'unpaid',
    },
    meetingLink: { type: String, trim: true },
    // Self-hosted Jitsi room (utils/videoCall.js): random, set once on
    // the first join, never sent in listings. Joining also needs a signed token.
    videoRoom: { type: String, select: false },
    // Informational only. `*TokenAt` is when the server last issued that side
    // a join token; `*JoinedAt`/`*LeftAt` are the last join/leave the call
    // screen reported (untrusted client events: used only to decide whether to
    // ring, never to complete, cancel or pay).
    videoAttendance: {
      patientTokenAt: Date,
      doctorTokenAt: Date,
      patientJoinedAt: Date,
      patientLeftAt: Date,
      doctorJoinedAt: Date,
      doctorLeftAt: Date,
    },
    prescription: { type: String, trim: true },
    // Last time the doctor saved the prescription: the date printed on it.
    prescribedAt: { type: Date },
    // The structured prescription from the portal (utils/prescriptionRx.js);
    // `prescription` above holds the same as text. Absent on older ones,
    // which print from the text.
    rx: {
      type: new mongoose.Schema(
        {
          complaints: { type: String, trim: true },
          diagnosis: { type: String, trim: true },
          medicines: [
            new mongoose.Schema(
              {
                name: { type: String, trim: true, required: true },
                dose: { type: String, trim: true },
                frequency: { type: String, trim: true },
                timing: { type: String, trim: true },
                duration: { type: String, trim: true },
                notes: { type: String, trim: true },
              },
              { _id: false },
            ),
          ],
          investigations: { type: String, trim: true },
          advice: { type: String, trim: true },
          followUp: { type: String, trim: true },
        },
        { _id: false },
      ),
      default: undefined,
    },
    // The patient's rating of a completed session (POST /api/consultation/:id/rating),
    // once only; `feedback` is its optional comment (encrypted, see below).
    rating: { type: Number, min: 1, max: 5 },
    feedback: { type: String, trim: true, maxlength: 500 },
    ratedAt: { type: Date },

    cashfreeOrderId: { type: String, index: true },

    startedAt: { type: Date },
    completedAt: { type: Date },

    // Who cancelled, why, and the refund trail for a paid booking that was
    // cancelled (utils/consultationLifecycle.js). Finance marks it processed
    // from Clinical finance → Refunds.
    cancelledBy: { type: String, enum: ['patient', 'doctor', 'system'] },
    cancelReason: { type: String, trim: true, maxlength: 300 },
    refundStatus: { type: String, enum: ['required', 'processed'] },
    refundedAt: { type: Date },
    refundReference: { type: String, trim: true, maxlength: 120 },
    // The automatic Cashfree refund for that cancellation
    // (utils/consultationRefunds.js). `refundStatus` above stays 'required'
    // until Cashfree reports SUCCESS, so finance still sees anything stuck.
    refundAuto: {
      type: new mongoose.Schema(
        {
          // pending: sent, waiting for Cashfree; success; failed: will retry
          // until `attempts` runs out; skipped: can't be automatic (no
          // Cashfree order), so it's refunded by hand.
          status: { type: String, enum: ['pending', 'success', 'failed', 'skipped'] },
          refundId: { type: String, trim: true },
          cfRefundId: { type: String, trim: true },
          providerStatus: { type: String, trim: true },
          attempts: { type: Number, default: 0 },
          lastError: { type: String, trim: true, maxlength: 300 },
          requestedAt: { type: Date },
          checkedAt: { type: Date },
          nextAttemptAt: { type: Date },
          // Claimed by a worker until then, so two can't send at once.
          lockedUntil: { type: Date },
        },
        { _id: false },
      ),
      default: undefined,
    },

    // Cashfree checkout session of a pending order, so a retry reuses it
    // instead of opening a second order (and a second charge).
    cashfreePaymentSessionId: { type: String, select: false },

    /** @deprecated use ConsultationMessage (encrypted). Nothing writes here any
     * more; src/scripts/migrateConsultationMessages.js moves old rows out. Never
     * sent to clients. */
    messages: { type: Array, default: undefined, select: false },
  },
  { timestamps: true },
);

consultationSchema.index({ userId: 1, doctorId: 1 });
// GET /api/consultation/my: a patient's sessions, newest first.
consultationSchema.index({ userId: 1, createdAt: -1 });
consultationSchema.index({ userId: 1, status: 1 });
// Doctor portal's paginated bookings list (GET /api/doctor/consultations).
consultationSchema.index({ doctorId: 1, createdAt: -1 });
// Slot capacity checks (is this doctor's slot already booked?).
consultationSchema.index({ doctorId: 1, scheduledFor: 1 });
consultationSchema.index({ refundStatus: 1 });
// The refund runner's sweep: refunds still owed, by their automatic state.
consultationSchema.index({ refundStatus: 1, 'refundAuto.status': 1 });

consultationSchema.plugin(encryptFields, { fields: ['feedback'] });

export default mongoose.model('Consultation', consultationSchema);
