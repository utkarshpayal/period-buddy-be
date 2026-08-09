import mongoose from 'mongoose';
import { hashPassword } from '../utils/password.js';
import { userRoleEnum, genderEnum } from '../enums/enums.js';

const userSchema = new mongoose.Schema(
  {
    firstName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    lastName: {
      type: String,
      required: true,
      trim: true,
      minlength: 2,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      match: [/^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/, 'Please provide a valid email'],
    },
    password: {
      // Not required for Google-only accounts (no googleId => must have a password).
      type: String,
      required: function () {
        return !this.googleId;
      },
      minlength: 8,
      select: false,
    },
    googleId: {
      type: String,
      unique: true,
      sparse: true,
      index: true,
    },
    authProvider: {
      type: String,
      enum: ['local', 'google'],
      default: 'local',
    },
    phone: { type: String, trim: true },
    dateOfBirth: { type: Date },
    gender: { type: String, enum: Object.values(genderEnum) },

    // Auth & status
    isEmailVerified: { type: Boolean, default: false },
    isActive: { type: Boolean, default: true },
    role: {
      type: String,
      enum: Object.values(userRoleEnum),
      default: userRoleEnum.USER,
    },
    lastLogin: { type: Date },

    // Profile
    profilePicture: { type: String },
    isProfileComplete: { type: Boolean, default: false },

    // Rewards — walletBalance replaces tokensEarned
    walletBalance: { type: Number, default: 0 },

    // Streaks — starts at 1 for the day the account is created
    streakCount: { type: Number, default: 1 },
    lastStreakDate: { type: String }, // 'YYYY-MM-DD'

    // Locale / notification
    timezone: { type: String, trim: true },
    country: { type: String, trim: true },
    language: { type: String, trim: true, default: 'en' },
    notificationToken: { type: String, trim: true },

    // Subscription
    subscriptionPlan: {
      type: String,
      enum: ['free', 'basic', 'premium'],
      default: 'free',
    },
    subscriptionExpiry: { type: Date },

    // Doctor invite flow — a gynecologist invited from the admin panel gets a
    // one-time set-password link. Hashed like OTPs; never returned in responses.
    inviteTokenHash: { type: String, select: false },
    inviteTokenExpiresAt: { type: Date, select: false },
    mustSetPassword: { type: Boolean, default: false },

    // Soft delete
    deletedAt: { type: Date, default: null },

    // Self-service account deletion (marketing site "delete my data" page).
    // Hashed like password/OTP elsewhere — never returned in API responses.
    selfDeleteOtpHash: { type: String, select: false },
    selfDeleteOtpExpiresAt: { type: Date, select: false },
    selfDeleteOtpAttempts: { type: Number, default: 0, select: false },
    selfDeleteLastSentAt: { type: Date, select: false },

    // Community feed — saved posts and self-reported posts (used by communityController)
    savedCommunityPosts: [{ type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost' }],
    reportedCommunityPosts: [
      {
        postId: { type: mongoose.Schema.Types.ObjectId, ref: 'CommunityPost' },
        reason: { type: String, trim: true },
        reportedAt: { type: Date, default: Date.now },
      },
    ],

    // Bookmarked blog posts (used by blogController)
    savedBlogs: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Blog' }],

    // Preferences (Profile > Preferences & Settings)
    notificationsEnabled: { type: Boolean, default: true },
    anonymousCommunityMode: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();
  if (this.$locals.skipPasswordHash) return next();

  try {
    this.password = await hashPassword(this.password);
    next();
  } catch (error) {
    next(error);
  }
});

// Strip password from JSON output
userSchema.methods.toJSON = function () {
  const obj = this.toObject({ virtuals: false });
  delete obj.password;
  return obj;
};

userSchema.index({ email: 1 });
userSchema.index({ isActive: 1, createdAt: -1 });

export default mongoose.model('User', userSchema);
