import mongoose from 'mongoose';

// Holds signup data + a hashed OTP until the email is verified. The real
// User document is only created once verifyOtp succeeds, so "create user
// account" genuinely happens after OTP validation rather than before it.
const pendingSignupSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
    },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, default: '', trim: true },
    password: { type: String, required: true }, // already hashed before save
    phone: { type: String, trim: true },
    dateOfBirth: { type: Date },
    gender: { type: String },
    role: { type: String, enum: ['user', 'partner'], default: 'user' },

    otpHash: { type: String, required: true },
    otpExpiresAt: { type: Date, required: true },
    otpAttempts: { type: Number, default: 0 },
    lastSentAt: { type: Date, default: Date.now },
  },
  { timestamps: true },
);

// TTL: purge abandoned pending signups a day after the OTP itself expired.
pendingSignupSchema.index({ otpExpiresAt: 1 }, { expireAfterSeconds: 60 * 60 * 24 });

export default mongoose.model('PendingSignup', pendingSignupSchema);
