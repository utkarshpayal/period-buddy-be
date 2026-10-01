import mongoose from 'mongoose';
import { encryptFields } from '../utils/fieldEncryption.js';

/**
 * A doctor's bank account or UPI ID, registered as a Cashfree Payouts
 * beneficiary. The full account number is encrypted at rest (and so can't be
 * queried); `last4`/`display` are what the UI shows. Removed methods are kept
 * (status 'removed') because past payouts point at them.
 */
const doctorPayoutMethodSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true },
    type: { type: String, enum: ['bank', 'upi'], required: true },
    accountHolderName: { type: String, required: true, trim: true, maxlength: 100 },

    accountNumber: { type: String },
    ifsc: { type: String, trim: true, uppercase: true },
    vpa: { type: String, trim: true, lowercase: true },
    last4: { type: String },
    display: { type: String, required: true },

    cashfreeBeneficiaryId: { type: String, required: true, unique: true },
    /** Set once Cashfree has it. Methods added in manual mode get registered
     * on their first Cashfree payout (doctorWallet.js#ensureBeneficiary). */
    beneficiaryRegisteredAt: { type: Date, default: null },
    status: { type: String, enum: ['active', 'removed'], default: 'active' },
    isDefault: { type: Boolean, default: false },
    /** Can't receive a payout before this (new-method cooldown). */
    usableFrom: { type: Date, default: () => new Date() },
    removedAt: { type: Date },
  },
  { timestamps: true },
);

doctorPayoutMethodSchema.index({ doctorId: 1, status: 1 });

doctorPayoutMethodSchema.plugin(encryptFields, { fields: ['accountNumber'] });

// Never send the full account number (encrypted or not) to a client.
const encryptedToJSON = doctorPayoutMethodSchema.get('toJSON') || {};
doctorPayoutMethodSchema.set('toJSON', {
  ...encryptedToJSON,
  transform(doc, ret, opts) {
    const out = encryptedToJSON.transform?.(doc, ret, opts) ?? ret;
    delete out.accountNumber;
    return out;
  },
});

export default mongoose.model('DoctorPayoutMethod', doctorPayoutMethodSchema);
