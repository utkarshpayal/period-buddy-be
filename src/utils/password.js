import bcrypt from 'bcryptjs';

export const hashPassword = async (password) => {
  try {
    const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_ROUNDS) || 10);
    return await bcrypt.hash(password, salt);
  } catch (error) {
    throw new Error('Error hashing password', { cause: error });
  }
};

export const comparePassword = async (password, hashedPassword) => {
  try {
    return await bcrypt.compare(password, hashedPassword);
  } catch (error) {
    throw new Error('Error comparing passwords', { cause: error });
  }
};

// 8+ characters with a lowercase letter, an uppercase letter, a number and a
// symbol. Any non-alphanumeric character counts as the symbol (it used to be
// only @$!%*?&, which rejected ordinary passwords like "Hello#123"). The app's
// signup checklist (lib/password.ts in The-Nura-App) mirrors this rule.
export const validatePasswordStrength = (password) =>
  typeof password === 'string' &&
  password.length >= 8 &&
  /[a-z]/.test(password) &&
  /[A-Z]/.test(password) &&
  /\d/.test(password) &&
  /[^A-Za-z\d]/.test(password);
