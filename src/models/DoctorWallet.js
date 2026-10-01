import mongoose from 'mongoose';

/**
 * Per-doctor lock document. It holds no balance (balances are always summed
 * from DoctorEarning and DoctorPayout, so they can't drift); a withdrawal
 * bumps `seq` inside its transaction, which makes two concurrent withdrawals
 * for the same doctor conflict, and the loser retries against the new
 * balance. See utils/doctorWallet.js#requestPayout.
 */
const doctorWalletSchema = new mongoose.Schema(
  {
    doctorId: { type: mongoose.Schema.Types.ObjectId, ref: 'Doctor', required: true, unique: true },
    seq: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export default mongoose.model('DoctorWallet', doctorWalletSchema);
