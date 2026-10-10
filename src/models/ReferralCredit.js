import mongoose from 'mongoose';

/**
 * Commission-free sessions a gynac holds: one row per grant (a successful
 * referral, or a bonus a Clinical Admin gave). Each paid consultation paid
 * after `grantedAt` uses one session (utils/referrals.js#reserveFreeSession):
 * its earning is created at 0% commission and listed in `usages`. A session
 * cancelled before completion gives it back.
 *
 * `status` is only ever active / revoked / expired; "used up" is
 * sessionsUsed >= sessionsGranted, so a returned session reopens the credit
 * without a status change.
 */
const referralCreditSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    kind: { type: String, enum: ['referral', 'manual'], required: true },
    referralId: { type: mongoose.Schema.Types.ObjectId, ref: 'DoctorReferral' },

    sessionsGranted: { type: Number, required: true, min: 1, max: 100 },
    sessionsUsed: { type: Number, default: 0, min: 0 },
    usages: [
      {
        _id: false,
        consultationId: { type: mongoose.Schema.Types.ObjectId, ref: 'Consultation' },
        commissionSavedMinor: { type: Number, default: 0 },
        usedAt: { type: Date },
      },
    ],

    status: { type: String, enum: ['active', 'revoked', 'expired'], default: 'active' },
    grantedAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, default: null },

    reason: { type: String, trim: true, maxlength: 300 },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revokedAt: { type: Date },
    revokedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    revokeReason: { type: String, trim: true, maxlength: 300 },
    /** Unused sessions taken away by the revoke. */
    sessionsRevoked: { type: Number, default: 0 },
  },
  { timestamps: true },
);

// One reward per referral, however many times the grant hook runs.
referralCreditSchema.index(
  { referralId: 1 },
  { unique: true, partialFilterExpression: { referralId: { $exists: true } } },
);
referralCreditSchema.index({ doctorId: 1, status: 1, expiresAt: 1, createdAt: 1 });
referralCreditSchema.index({ 'usages.consultationId': 1 });
referralCreditSchema.index({ createdAt: -1 });

export default mongoose.model('ReferralCredit', referralCreditSchema);
