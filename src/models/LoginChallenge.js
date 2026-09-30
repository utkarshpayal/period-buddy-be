import mongoose from 'mongoose';

/**
 * LoginChallenge — the pending second step of a staff or doctor sign-in
 * (utils/loginSecurity.js). The password was right; the session starts only
 * once the emailed code is entered. Both the challenge token and the code
 * are stored hashed. Expired rows are removed by the TTL index.
 */
const loginChallengeSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    tokenHash: { type: String, required: true, unique: true },
    // 'email': a code we emailed (codeHash). 'totp': the person's
    // authenticator app or a recovery code (checked against the User).
    method: { type: String, enum: ['email', 'totp'], default: 'email' },
    codeHash: { type: String },
    attempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true },
);

loginChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export default mongoose.model('LoginChallenge', loginChallengeSchema);
