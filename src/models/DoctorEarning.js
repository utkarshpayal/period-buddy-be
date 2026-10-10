import mongoose from 'mongoose';

/**
 * The doctor's side of the ledger. One `consultation` row per paid
 * consultation (unique), plus admin `adjustment` rows (credit or debit).
 * Amounts are paise; a debit adjustment has a negative netMinor.
 *
 * - status 'active' + availableAt null      → on hold (session not completed)
 * - status 'active' + availableAt in future → on hold (refund window)
 * - status 'active' + availableAt <= now    → withdrawable
 * - status 'reversed'                       → no longer owed (cancelled/refunded)
 *
 * The commission rate is copied in when the row is created, so changing a
 * rate later never rewrites past earnings.
 */
const doctorEarningSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    type: { type: String, enum: ['consultation', 'adjustment'], required: true },
    consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation' },

    currency: { type: String, default: 'INR' },
    grossMinor: { type: Number, required: true },
    commissionBps: { type: Number, default: 0 },
    /** 'referral': a commission-free session from a ReferralCredit (referralCreditId). */
    commissionSource: {
      type: String,
      enum: ['default', 'doctor', 'none', 'referral'],
      default: 'none',
    },
    referralCreditId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReferralCredit' },
    commissionMinor: { type: Number, default: 0 },
    netMinor: { type: Number, required: true },

    status: { type: String, enum: ['active', 'reversed'], default: 'active' },
    paidAt: { type: Date },
    completedAt: { type: Date },
    availableAt: { type: Date, default: null },

    reversedAt: { type: Date },
    reversalReason: { type: String, trim: true, maxlength: 300 },
    reversedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    /** Adjustments: why, and who. */
    note: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

doctorEarningSchema.index(
  { consultationId: 1 },
  { unique: true, partialFilterExpression: { type: 'consultation' } },
);
doctorEarningSchema.index({ doctorId: 1, status: 1, availableAt: 1 });
doctorEarningSchema.index({ doctorId: 1, createdAt: -1 });
doctorEarningSchema.index({ createdAt: -1 });

export default mongoose.model('DoctorEarning', doctorEarningSchema);
