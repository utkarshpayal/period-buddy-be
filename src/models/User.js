import mongoose from 'mongoose';
import { hashPassword } from '../utils/password.js';
import { encryptFields } from '../utils/fieldEncryption.js';
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
    // Optional since signup only asks for a first name. Empty string rather
    // than missing, so older display code that concatenates it never prints
    // "undefined".
    lastName: {
      type: String,
      default: '',
      trim: true,
      maxlength: 50,
    },
    email: {
      type: String,
      required: true,
      unique: true,
      lowercase: true,
      trim: true,
      // Any domain ending (.care, .info, .digital…): the old pattern only
      // allowed 2-3 letters, which rejected every @thenura.care address.
      // Signup already checks the format properly (schemas/authSchema.js).
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/, 'Please provide a valid email'],
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
    // Last "sign-in blocked, account suspended" email (utils/accountStatus.js),
    // used to throttle it to one per 24h.
    suspensionNoticeSentAt: { type: Date },
    role: {
      type: String,
      enum: Object.values(userRoleEnum),
      default: userRoleEnum.USER,
    },
    lastLogin: { type: Date },
    // Any token issued before this is refused (log out everywhere, password
    // change, deletion, suspension); see utils/sessions.js.
    sessionsRevokedAt: { type: Date },
    // Choices under the privacy settings (utils/privacy.js). Unset = never asked.
    consents: {
      aiProcessing: {
        granted: { type: Boolean },
        version: { type: String },
        updatedAt: { type: Date },
      },
    },
    // Throttles "Download my data" (authController.exportData).
    lastDataExportAt: { type: Date, select: false },
    // Per-account lockout after repeated wrong passwords (utils/loginSecurity.js).
    failedLoginCount: { type: Number, default: 0, select: false },
    lockUntil: { type: Date, select: false },
    // Staff / doctor two-step sign-in with an authenticator app (utils/totp.js,
    // controllers/twoFactorController.js). Without it they get emailed codes.
    // The secrets are encrypted at rest and never leave the server after setup.
    twoFactor: {
      totpSecret: { type: String, select: false },
      pendingTotpSecret: { type: String, select: false },
      totpEnabledAt: { type: Date },
      // Last accepted time step, so a code can't be used twice.
      lastTotpStep: { type: Number, select: false },
      // sha256 of each unused recovery code.
      recoveryCodeHashes: { type: [String], select: false, default: undefined },
    },
    // Privacy settings (app: Profile → Data privacy & security).
    privacySettings: {
      // Pushes say "You have a new update" instead of their text, so a
      // locked phone never shows health details (models/Notification.js).
      hideNotificationDetails: { type: Boolean, default: true },
      // Nura AI chats older than this are deleted (utils/retentionRunner.js).
      // 0 = keep until the person deletes them.
      aiChatRetentionDays: { type: Number, default: 0, enum: [0, 30, 90, 365] },
      // Email when the account signs in on a new device (utils/loginSecurity.js).
      newSignInAlerts: { type: Boolean, default: true },
    },
    // This person's own Home layout (app: Profile → Customize Home;
    // utils/homeLayout.js). Unset = the app's default Home.
    homeLayout: {
      order: { type: [String], default: undefined },
      hidden: { type: [String], default: undefined },
      // Unset = the app's default shortcuts; [] = none.
      shortcuts: { type: [String], default: undefined },
      // How each shortcut looks: { [tileKey]: { look, color } } (checked in utils/homeLayout.js).
      shortcutStyles: { type: mongoose.Schema.Types.Mixed, default: undefined },
      // Per-block heading and item picks: { [blockKey]: { title, items } }.
      blocks: { type: mongoose.Schema.Types.Mixed, default: undefined },
      updatedAt: { type: Date },
    },

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
    // State/UT — used to personalize state government schemes (e.g. Rajasthan).
    state: { type: String, trim: true },
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
    // Admin Workspace staff — who invited this account (Team & Access).
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },

    // Soft delete — set by accountLifecycle.softDeleteAccount (the in-app
    // "Delete account" action). A deleted account can't be reactivated.
    deletedAt: { type: Date, default: null },
    // Set when an admin removes someone from the workspace (staffController.
    // removeStaff demotes them to a plain `user`), so the app-users screen can
    // still treat the account as staff-managed.
    staffRemovedAt: { type: Date },

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
  delete obj.failedLoginCount;
  delete obj.lockUntil;
  if (obj.twoFactor) {
    obj.twoFactor = { totpEnabledAt: obj.twoFactor.totpEnabledAt ?? null };
  }
  return obj;
};

// Authenticator secrets are encrypted at rest (utils/fieldEncryption.js).
userSchema.plugin(encryptFields, {
  fields: ['twoFactor.totpSecret', 'twoFactor.pendingTotpSecret'],
});

// email is indexed by its `unique: true`.
userSchema.index({ createdAt: -1 });
userSchema.index({ isActive: 1, createdAt: -1 });

export default mongoose.model('User', userSchema);
