import User from '../models/User.js';
import Doctor from '../models/Doctor.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { comparePassword } from '../utils/password.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { canManageRole, isStaffRole } from '../config/permissions.js';
import { canUseSecondFactor, secondFactorEnabled } from '../utils/loginSecurity.js';
import { generateRecoveryCodes, generateTotpSecret, matchTotp, otpauthUrl } from '../utils/totp.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import logger from '../utils/logger.js';

/**
 * Two-step sign-in with an authenticator app, for staff and doctors
 * (docs/SECURITY.md). Set up from the Admin Workspace's account page:
 * setup → scan the QR code → enable with a first code → save the recovery
 * codes. Without it they get emailed codes (utils/loginSecurity.js).
 */

const RECOVERY_SELECT = '+twoFactor.recoveryCodeHashes';

const describe = (user) => ({
  // Is a second step asked at sign-in for this account right now?
  required: secondFactorEnabled() || Boolean(user.twoFactor?.totpEnabledAt),
  method: user.twoFactor?.totpEnabledAt ? 'totp' : 'email',
  totpEnabledAt: user.twoFactor?.totpEnabledAt ?? null,
  recoveryCodesLeft: user.twoFactor?.recoveryCodeHashes?.length ?? 0,
});

const eligibleOr403 = (req, res) => {
  if (canUseSecondFactor(req.user)) return true;
  sendError(res, HTTP_STATUS.FORBIDDEN, 'Two-step sign-in is for staff and doctor accounts');
  return false;
};

/** Re-check the password before turning protection off or showing new codes. */
const passwordOk = async (userId, password) => {
  const user = await User.findById(userId).select('+password');
  return Boolean(user?.password && password && (await comparePassword(password, user.password)));
};

/** GET /api/auth/2fa */
export const getTwoFactor = async (req, res, next) => {
  try {
    if (!eligibleOr403(req, res)) return;
    const user = await User.findById(req.userId).select(RECOVERY_SELECT);
    return sendResponse(res, HTTP_STATUS.OK, 'Two-step sign-in', describe(user));
  } catch (error) {
    next(error);
  }
};

/** POST /api/auth/2fa/totp/setup — a new secret to scan; not active until enabled. */
export const setupTotp = async (req, res, next) => {
  try {
    if (!eligibleOr403(req, res)) return;
    if (req.user.twoFactor?.totpEnabledAt) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'An authenticator app is already set up. Turn it off first to set up a new one.',
      );
    }
    const secret = generateTotpSecret();
    await User.updateOne({ _id: req.userId }, { 'twoFactor.pendingTotpSecret': secret });
    return sendResponse(res, HTTP_STATUS.OK, 'Scan the code with your authenticator app', {
      secret,
      otpauthUrl: otpauthUrl({ secret, account: req.user.email }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/auth/2fa/totp/enable — body { code }: the first code proves the scan worked. */
export const enableTotp = async (req, res, next) => {
  try {
    if (!eligibleOr403(req, res)) return;
    const user = await User.findById(req.userId).select('+twoFactor.pendingTotpSecret');
    const pending = user?.twoFactor?.pendingTotpSecret;
    if (!pending) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Start the setup again.');
    }
    const step = matchTotp(pending, String(req.body?.code ?? '').trim());
    if (step === null) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        "That code isn't right. Check your phone's time is set automatically and try the newest code.",
      );
    }
    const { codes, hashes } = generateRecoveryCodes();
    await User.updateOne(
      { _id: req.userId },
      {
        $set: {
          'twoFactor.totpSecret': pending,
          'twoFactor.totpEnabledAt': new Date(),
          'twoFactor.lastTotpStep': step,
          'twoFactor.recoveryCodeHashes': hashes,
        },
        $unset: { 'twoFactor.pendingTotpSecret': 1 },
      },
    );
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.TWO_FACTOR_ENABLED,
      resourceType: 'user',
      resourceId: req.userId,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Authenticator app turned on', {
      recoveryCodes: codes,
    });
  } catch (error) {
    next(error);
  }
};

const TWO_FACTOR_UNSET = {
  'twoFactor.totpSecret': 1,
  'twoFactor.pendingTotpSecret': 1,
  'twoFactor.totpEnabledAt': 1,
  'twoFactor.lastTotpStep': 1,
  'twoFactor.recoveryCodeHashes': 1,
};

/** POST /api/auth/2fa/totp/disable — body { password }. Back to emailed codes. */
export const disableTotp = async (req, res, next) => {
  try {
    if (!eligibleOr403(req, res)) return;
    if (!(await passwordOk(req.userId, req.body?.password))) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Your password is incorrect');
    }
    await User.updateOne({ _id: req.userId }, { $unset: TWO_FACTOR_UNSET });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.TWO_FACTOR_DISABLED,
      resourceType: 'user',
      resourceId: req.userId,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Authenticator app turned off');
  } catch (error) {
    next(error);
  }
};

/** POST /api/auth/2fa/recovery-codes — body { password }. Replaces all of them. */
export const regenerateRecoveryCodes = async (req, res, next) => {
  try {
    if (!eligibleOr403(req, res)) return;
    if (!req.user.twoFactor?.totpEnabledAt) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Set up an authenticator app first');
    }
    if (!(await passwordOk(req.userId, req.body?.password))) {
      return sendError(res, HTTP_STATUS.UNAUTHORIZED, 'Your password is incorrect');
    }
    const { codes, hashes } = generateRecoveryCodes();
    await User.updateOne({ _id: req.userId }, { 'twoFactor.recoveryCodeHashes': hashes });
    logger.info('recovery_codes_regenerated', {
      action: 'recovery_codes_regenerated',
      userId: req.userId,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'New recovery codes', { recoveryCodes: codes });
  } catch (error) {
    next(error);
  }
};

/**
 * Turn someone's authenticator off (they lost their phone and their recovery
 * codes). They sign in with emailed codes again and can set up a new app.
 */
const resetFor = async (req, res, target) => {
  await User.updateOne({ _id: target._id }, { $unset: TWO_FACTOR_UNSET });
  await recordAudit({
    req,
    action: AUDIT_ACTIONS.TWO_FACTOR_RESET,
    resourceType: 'user',
    resourceId: target._id,
    metadata: { email: target.email, role: target.role },
  });
  return sendResponse(res, HTTP_STATUS.OK, 'Authenticator app reset');
};

/** POST /api/admin/staff/:id/reset-2fa (staff.manage) */
export const resetStaffTwoFactor = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid staff id');
    }
    const target = await User.findById(req.params.id).select('email role');
    if (!target || !isStaffRole(target.role)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Staff member not found');
    }
    if (String(target._id) === String(req.userId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Ask another Super Admin to reset yours');
    }
    if (!canManageRole(req.user.role, target.role)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You cannot manage this team member');
    }
    return await resetFor(req, res, target);
  } catch (error) {
    next(error);
  }
};

/** POST /api/doctor/admin/:id/reset-2fa (doctors.manage); :id is the Doctor profile. */
export const resetDoctorTwoFactor = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid doctor id');
    }
    const doctor = await Doctor.findById(req.params.id).select('userId');
    const target = doctor?.userId ? await User.findById(doctor.userId).select('email role') : null;
    if (!target) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Doctor not found');
    return await resetFor(req, res, target);
  } catch (error) {
    next(error);
  }
};
