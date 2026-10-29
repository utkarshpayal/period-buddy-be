/**
 * List gynac (role `doctor`) accounts, or set a password on one so it can be
 * used as a test login without going through the invite email.
 *
 *   node src/scripts/setDoctorPassword.js                         (list gynacs)
 *   node src/scripts/setDoctorPassword.js --email dr@example.com  (random password)
 *   node src/scripts/setDoctorPassword.js --email dr@example.com --password 'Test@Nura2026!'
 *
 * Uses MONGODB_URI from .env (or the environment); point it at staging with
 * DOTENV_CONFIG_PATH=.env.stage. Setting a password also clears any pending
 * invite and signs the account out everywhere.
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import crypto from 'crypto';
import mongoose from 'mongoose';
import User from '../models/User.js';
import { validatePasswordStrength } from '../utils/password.js';
import { revokeAllSessions } from '../utils/sessions.js';

const arg = (name) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};
const email = String(arg('email') || '')
  .trim()
  .toLowerCase();

/** 16 characters that always pass the password rules (utils/password.js). */
const makePassword = () => {
  const pick = (set) => set[crypto.randomInt(set.length)];
  const lower = 'abcdefghjkmnpqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const symbols = '!@#$%^&*-_=+?';
  const all = lower + upper + digits + symbols;
  const chars = [pick(lower), pick(upper), pick(digits), pick(symbols)];
  while (chars.length < 16) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i -= 1) {
    const j = crypto.randomInt(i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
};

const password = arg('password') || makePassword();
if (email && !validatePasswordStrength(password)) {
  console.error('That password fails the password rules (upper, lower, digit, symbol, length).');
  process.exit(1);
}

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);
console.log(`Database: ${mongoose.connection.host}/${mongoose.connection.name}`);
try {
  if (!email) {
    const doctors = await User.find({ role: 'doctor' })
      .select('email firstName lastName isActive mustSetPassword')
      .sort({ createdAt: -1 })
      .lean();
    if (!doctors.length) console.log('No gynac accounts found.');
    else
      console.table(
        doctors.map((d) => ({
          email: d.email,
          name: [d.firstName, d.lastName].filter(Boolean).join(' '),
          active: d.isActive,
          pendingInvite: Boolean(d.mustSetPassword),
        })),
      );
  } else {
    const user = await User.findOne({ email, role: 'doctor' });
    if (!user) {
      console.error(`No gynac account with email ${email}. Run without --email to list them.`);
      process.exitCode = 1;
    } else {
      user.password = password;
      user.isActive = true;
      user.isEmailVerified = true;
      user.mustSetPassword = false;
      user.inviteTokenHash = undefined;
      user.inviteTokenExpiresAt = undefined;
      await user.save();
      await revokeAllSessions(user._id, 'doctor_password_reset_script');

      console.log('\nPassword set');
      console.log(`  Email:    ${email}`);
      console.log(`  Password: ${password}\n`);
    }
  }
} catch (error) {
  console.error(`Couldn't update the gynac: ${error.message}`);
  process.exitCode = 1;
} finally {
  await mongoose.disconnect();
}
