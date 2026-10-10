import mongoose from 'mongoose';

/**
 * A gynac referring a colleague (the Admin Workspace repo's
 * docs/gynac-referrals-plan.md). A referral from the portal invites the
 * colleague straight away (no admin review; their bookings start paused):
 *
 *   invited ─referred gynac sets password→ onboarded (+ reward)
 *      └─admin closes it / referred doctor deactivated or deleted→ cancelled
 *
 * A Clinical Admin can also log an offline lead (source 'admin'), which
 * starts at `submitted` and is approved (invited) or rejected:
 *
 *   submitted ─approve→ invited … │ ─reject→ rejected │ ─withdraw→ withdrawn
 *
 * `isLive` mirrors "submitted, invited or onboarded" so one email can only
 * ever be referred once at a time (a partial unique index; set it with
 * utils/referralMath.js#statusFields).
 */
const doctorReferralSchema = new mongoose.Schema(
  {
    referrerDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    referredName: { type: String, required: true, trim: true, maxlength: 120 },
    referredEmail: { type: String, required: true, trim: true, lowercase: true, maxlength: 254 },
    referredPhone: { type: String, trim: true, maxlength: 20 },
    note: { type: String, trim: true, maxlength: 500 },
    source: { type: String, enum: ['portal', 'admin'], default: 'portal' },

    status: {
      type: String,
      enum: ['submitted', 'invited', 'onboarded', 'rejected', 'withdrawn', 'cancelled'],
      default: 'submitted',
    },
    isLive: { type: Boolean, default: true },

    /** The Doctor row created by the invite. */
    referredDoctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor' },

    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    reviewedAt: { type: Date },
    /** Why it was rejected or cancelled (shown to the referrer). */
    closeReason: { type: String, trim: true, maxlength: 300 },
    invitedAt: { type: Date },
    onboardedAt: { type: Date },

    /** Reward: 'granted' with the credit, or 'skipped' with a reason. */
    rewardStatus: { type: String, enum: ['pending', 'granted', 'skipped'], default: 'pending' },
    rewardSkipReason: { type: String, trim: true, maxlength: 200 },
    rewardSessions: { type: Number, min: 0 },
    creditId: { type: mongoose.Schema.Types.ObjectId, ref: 'ReferralCredit' },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

doctorReferralSchema.index(
  { referredEmail: 1 },
  { unique: true, partialFilterExpression: { isLive: true } },
);
doctorReferralSchema.index({ referrerDoctorId: 1, createdAt: -1 });
doctorReferralSchema.index({ referredDoctorId: 1 });
doctorReferralSchema.index({ status: 1, createdAt: -1 });

export default mongoose.model('DoctorReferral', doctorReferralSchema);
