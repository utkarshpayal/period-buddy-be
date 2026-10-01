import mongoose from 'mongoose';

/**
 * One withdrawal from a doctor's wallet to a payout method, via Cashfree
 * Payouts. Statuses and allowed moves: utils/payoutMath.js (TRANSITIONS).
 * `requested`/`approved`/`processing` hold the amount; `success` spends it;
 * `failed`/`rejected`/`cancelled`/`reversed` give it back to the wallet.
 *
 * `transferId` is the Cashfree transfer_id, fixed at creation, so a retried
 * dispatch can never send the money twice.
 */
const payoutEventSchema = new mongoose.Schema(
  {
    at: { type: Date, default: () => new Date() },
    status: { type: String },
    by: { type: String }, // 'doctor' | 'admin' | 'cashfree' | 'system'
    note: { type: String, maxlength: 300 },
  },
  { _id: false },
);

const doctorPayoutSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    amountMinor: { type: Number, required: true, min: 100 },
    currency: { type: String, default: 'INR' },

    status: {
      type: String,
      enum: [
        'requested',
        'approved',
        'processing',
        'success',
        'failed',
        'rejected',
        'cancelled',
        'reversed',
      ],
      default: 'requested',
    },

    methodId: { type: mongoose.Schema.Types.ObjectId, ref: 'DoctorPayoutMethod', required: true },
    /** Snapshot, so history still reads right after the method is removed. */
    method: {
      type: { type: String },
      display: { type: String },
      accountHolderName: { type: String },
      cashfreeBeneficiaryId: { type: String },
    },

    /** Fixed when requested: 'manual' payouts are never sent to Cashfree. */
    provider: { type: String, enum: ['manual', 'cashfree'], default: 'cashfree' },

    transferId: { type: String, required: true, unique: true },
    /** Doctor-supplied Idempotency-Key, unique per doctor (double-click safe). */
    idempotencyKey: { type: String, required: true },

    cfTransferId: { type: String },
    cfStatus: { type: String },
    cfStatusCode: { type: String },
    utr: { type: String },
    failureReason: { type: String, maxlength: 300 },

    requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    approvedAt: { type: Date },
    rejectedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    /** Manual payouts: the admin who marked it paid (reference goes in `utr`). */
    paidManuallyBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewNote: { type: String, trim: true, maxlength: 300 },

    dispatchAttempts: { type: Number, default: 0 },
    lastDispatchAt: { type: Date },
    /** Next time the reconciler should look at this payout. */
    nextCheckAt: { type: Date },
    completedAt: { type: Date },

    events: { type: [payoutEventSchema], default: [] },
  },
  { timestamps: true },
);

doctorPayoutSchema.index({ doctorId: 1, idempotencyKey: 1 }, { unique: true });
doctorPayoutSchema.index({ doctorId: 1, createdAt: -1 });
doctorPayoutSchema.index({ status: 1, nextCheckAt: 1 });
doctorPayoutSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('DoctorPayout', doctorPayoutSchema);
