import crypto from 'crypto';
import bcrypt from 'bcryptjs';

export const OTP_LENGTH = 6;
export const OTP_EXPIRY_MINUTES = parseInt(process.env.OTP_EXPIRY_MINUTES, 10) || 10;
export const OTP_RESEND_COOLDOWN_SECONDS = 30;
export const OTP_MAX_ATTEMPTS = 5;

export const generateOtp = () => {
  const max = 10 ** OTP_LENGTH;
  const otp = crypto.randomInt(0, max).toString().padStart(OTP_LENGTH, '0');
  return otp;
};

export const hashOtp = async (otp) => bcrypt.hash(otp, 10);

export const compareOtp = async (otp, otpHash) => bcrypt.compare(otp, otpHash);

export const getOtpExpiry = () => new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
