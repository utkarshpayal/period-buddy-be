import mongoose from 'mongoose';

/**
 * Singleton (`key: 'default'`) holding the Clinical Admin's commission and
 * withdrawal rules. Amounts are paise, rates basis points (see
 * utils/payoutMath.js). Read through utils/doctorWallet.js#getPayoutSettings,
 * which creates it with these defaults on first use.
 */
const clinicalPayoutSettingsSchema = new mongoose.Schema(
  {
    key: { type: String, default: 'default', unique: true },

    /** Platform commission on each paid session, unless a doctor has an override. */
    defaultCommissionBps: { type: Number, default: 2000, min: 0, max: 10_000 },
    /** Days after a session is completed before its earning can be withdrawn (refund window). */
    holdDays: { type: Number, default: 3, min: 0, max: 60 },

    /** How withdrawals are paid. 'manual': a Clinical Admin transfers the money
     * from the bank and marks it paid with the UTR. 'cashfree': sent through
     * Cashfree Payouts (needs the CASHFREE_PAYOUT_* keys). */
    payoutProvider: { type: String, enum: ['manual', 'cashfree'], default: 'manual' },
    /** A paid session nobody marked completed becomes withdrawable this many
     * days after payment anyway (0 = only on completion). */
    autoReleaseDays: { type: Number, default: 7, min: 0, max: 90 },

    /** Master switch for new withdrawal requests (does not stop ones in flight). */
    payoutsEnabled: { type: Boolean, default: true },
    /** true: a Clinical Admin approves each withdrawal. false: sent to Cashfree straight away. */
    requireApproval: { type: Boolean, default: true },
    minWithdrawalMinor: { type: Number, default: 10_000, min: 100 },
    maxWithdrawalMinor: { type: Number, default: 10_000_000, min: 100 },
    /** A newly added bank account / UPI ID can't be paid to for this long. */
    newMethodCooldownHours: { type: Number, default: 24, min: 0, max: 168 },

    /** Paid consultations from this date on are in doctors' wallets (the
     * reconciler's lower bound). Defaults to the beginning of time, so every
     * past paid session is brought in too, split at the doctor's current rate. */
    earningsStartAt: { type: Date, default: () => new Date(0) },

    /** Gynac referral program (utils/referrals.js). Off stops new referrals
     * only: referrals already invited still earn their reward, and credits
     * already granted keep working. */
    referralProgramEnabled: { type: Boolean, default: true },
    /** When a referral is rewarded: 'onboarded' (the colleague sets their
     * password) or 'first_session' (their first completed paid consultation,
     * which stops self-referrals with a second email). */
    referralRewardTrigger: {
      type: String,
      enum: ['onboarded', 'first_session'],
      default: 'onboarded',
    },
    /** Commission-free sessions per successful referral (copied into each grant). */
    referralRewardSessions: { type: Number, default: 5, min: 1, max: 50 },
    /** Days a granted credit stays usable (null = never expires). */
    referralCreditExpiryDays: { type: Number, default: null, min: 1, max: 3650 },
    /** Referrals a gynac may have open (submitted / invited) at once. */
    referralMaxOpenPerDoctor: { type: Number, default: 10, min: 1, max: 100 },

    updatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

export default mongoose.model('ClinicalPayoutSettings', clinicalPayoutSettingsSchema);
