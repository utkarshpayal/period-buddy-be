import mongoose from 'mongoose';

/** UserSession — tracks active sessions for multi-device support and audit. */
const userSessionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    token: { type: String, required: true, unique: true }, // JWT jti or hashed token
    deviceInfo: {
      platform: { type: String, trim: true }, // 'ios' | 'android' | 'web'
      deviceId: { type: String, trim: true },
      appVersion: { type: String, trim: true },
    },
    ipAddress: { type: String, trim: true },
    lastActiveAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true },
    isRevoked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

userSessionSchema.index({ userId: 1, isRevoked: 1 });
userSessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 }); // TTL index

export default mongoose.model('UserSession', userSessionSchema);
