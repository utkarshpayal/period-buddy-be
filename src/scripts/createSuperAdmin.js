/**
 * Create a Super Admin (role `admin`) for the Admin Workspace and CMS, with a
 * strong random password printed once.
 *
 *   node src/scripts/createSuperAdmin.js --email you@thenura.care --name "Your Name"
 *   node src/scripts/createSuperAdmin.js --email you@thenura.care --reset-password
 *
 * Uses MONGODB_URI from .env (or the environment), so check which database
 * that is before running it. An existing account is never changed unless
 * `--reset-password` is given; that sets a new password, makes the account a
 * Super Admin and signs it out everywhere. Change the password after the
 * first sign-in if you like, and consider setting up an authenticator app
 * (Account & Settings → Two-step sign-in).
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { validatePasswordStrength } from '../utils/password.js';
import { revokeAllSessions } from '../utils/sessions.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const email = String(arg('email') || '')
  .trim()
  .toLowerCase();
const name = String(arg('name') || 'Super Admin').trim();
const resetPassword = process.argv.includes('--reset-password');

if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  console.error(
    'Usage: node src/scripts/createSuperAdmin.js --email you@example.com [--name "Your Name"] [--reset-password]',
  );
  process.exit(1);
}

/** 20 characters that always pass the password rules (utils/password.js). */
const makePassword = () => {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+?';
  const all = lower + upper + digits + symbols;
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < 20) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

const password = makePassword();
if (!validatePasswordStrength(password)) throw new Error('Generated password failed the rules');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}
const host = (() => {
  try {
    return new URL(uri.replace(/^mongodb\+srv:/, 'https:').replace(/^mongodb:/, 'http:')).hostname;
  } catch {
    return 'the configured database';
  }
})();

await mongoose.connect(uri);
try {
  const existing = await User.findOne({ email });
  if (existing && !resetPassword) {
    console.error(
      `${email} already has an account (role: ${existing.role}). Nothing changed.\n` +
        'Run again with --reset-password to set a new password and make it a Super Admin.',
    );
    process.exitCode = 1;
  } else {
    const [firstName, ...rest] = name.split(/\s+/);
    const user =
      existing ?? new User({ email, firstName: firstName.length >= 2 ? firstName : 'Admin' });
    if (!existing) user.lastName = rest.join(' ');
    user.password = password;
    user.role = 'admin';
    user.isActive = true;
    user.isEmailVerified = true;
    user.mustSetPassword = false;
    user.inviteTokenHash = undefined;
    user.inviteTokenExpiresAt = undefined;
    user.isProfileComplete = true;
    await user.save();
    if (existing) await revokeAllSessions(user._id, 'super_admin_password_reset');
    await recordAudit({
      action: existing ? AUDIT_ACTIONS.STAFF_ROLE_CHANGED : AUDIT_ACTIONS.STAFF_INVITED,
      resourceType: 'staff',
      resourceId: String(user._id),
      metadata: { email, role: 'admin', via: 'createSuperAdmin script' },
    });

    console.log(`\n${existing ? 'Updated' : 'Created'} Super Admin on ${host}`);
    console.log(`  Email:    ${email}`);
    console.log(`  Password: ${password}`);
    console.log('\nThis password is shown only once. Store it in a password manager.\n');
  }
} catch (error) {
  // A clear message, not the logger's crash dump.
  console.error(`Couldn't create the Super Admin: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
