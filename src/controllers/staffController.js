import crypto from 'crypto';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { isValidObjectId, escapeRegex } from '../utils/apiHelpers.js';
import { sendMail } from '../utils/mailer.js';
import { getStaffInviteTemplate } from '../templates/emailTemplates.js';
import { INVITE_EXPIRY_HOURS, buildInviteUrl, createInviteToken } from '../utils/invite.js';
import { userRoleEnum } from '../enums/enums.js';
import {
  STAFF_ROLES,
  canManageRole,
  describeAccess,
  getAssignableRoles,
  isStaffRole,
} from '../config/permissions.js';
import { cancelPendingChangeRequests, suspendAccount } from '../utils/accountLifecycle.js';

const STAFF_FIELDS =
  'firstName lastName email role isActive mustSetPassword lastLogin invitedBy createdAt updatedAt';

const displayName = (user) => `${user?.firstName || ''} ${user?.lastName || ''}`.trim();

const serializeStaff = (user, actorRole) => {
  const plain = user.toObject ? user.toObject() : user;
  const invitedBy = plain.invitedBy && typeof plain.invitedBy === 'object' ? plain.invitedBy : null;
  return {
    id: String(plain._id),
    firstName: plain.firstName,
    lastName: plain.lastName,
    name: displayName(plain),
    email: plain.email,
    role: plain.role,
    roleLabel: STAFF_ROLES[plain.role]?.label ?? plain.role,
    department: STAFF_ROLES[plain.role]?.department ?? null,
    status: !plain.isActive ? 'suspended' : plain.mustSetPassword ? 'invited' : 'active',
    lastLogin: plain.lastLogin,
    createdAt: plain.createdAt,
    invitedBy: invitedBy
      ? { id: String(invitedBy._id), name: displayName(invitedBy), email: invitedBy.email }
      : null,
    canManage: canManageRole(actorRole, plain.role),
  };
};

/** Load a staff member the caller is allowed to manage, or send the error. */
const loadManageableStaff = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid staff id');
    return null;
  }
  const user = await User.findById(req.params.id);
  if (!user || !isStaffRole(user.role)) {
    sendError(res, HTTP_STATUS.NOT_FOUND, 'Staff member not found');
    return null;
  }
  if (String(user._id) === String(req.userId)) {
    sendError(res, HTTP_STATUS.BAD_REQUEST, 'You cannot change your own access');
    return null;
  }
  if (!canManageRole(req.user.role, user.role)) {
    sendError(res, HTTP_STATUS.FORBIDDEN, 'You cannot manage this team member');
    return null;
  }
  return user;
};

/** Never leave the workspace without an active Super Admin. */
const isLastActiveSuperAdmin = async (user) => {
  if (user.role !== userRoleEnum.ADMIN || !user.isActive) return false;
  const others = await User.countDocuments({
    _id: { $ne: user._id },
    role: userRoleEnum.ADMIN,
    isActive: true,
  });
  return others === 0;
};

const sendStaffInvite = async ({ user, rawToken, invitedBy }) => {
  const inviteUrl = buildInviteUrl(user.email, rawToken);
  const mailResult = await sendMail({
    to: user.email,
    subject: 'Your Nura Workspace invitation',
    html: getStaffInviteTemplate({
      name: user.firstName,
      roleLabel: STAFF_ROLES[user.role]?.label ?? user.role,
      invitedByName: displayName(invitedBy),
      inviteUrl,
      expiryHours: INVITE_EXPIRY_HOURS,
    }),
  });
  return { inviteUrl, inviteEmailDelivered: mailResult?.delivered !== false };
};

/** GET /api/admin/me — the caller's role, department and permissions. */
export const getMyAccess = async (req, res) =>
  sendResponse(res, HTTP_STATUS.OK, 'Access loaded', {
    user: req.user.toJSON(),
    access: describeAccess(req.user.role),
  });

/**
 * GET /api/admin/staff — staff the caller can see: everyone for a Super
 * Admin, otherwise their own department.
 * Query: ?search= &role= &status=active|invited|suspended
 */
export const listStaff = async (req, res, next) => {
  try {
    const actorRole = req.user.role;
    const actorDept = STAFF_ROLES[actorRole]?.department;
    const visibleRoles =
      actorRole === userRoleEnum.ADMIN
        ? Object.keys(STAFF_ROLES)
        : Object.keys(STAFF_ROLES).filter((role) => STAFF_ROLES[role].department === actorDept);

    const { search, role, status } = req.query;
    const filter = {
      role: { $in: role && visibleRoles.includes(role) ? [role] : visibleRoles },
      deletedAt: null,
    };
    if (status === 'suspended') filter.isActive = false;
    if (status === 'active')
      Object.assign(filter, { isActive: true, mustSetPassword: { $ne: true } });
    if (status === 'invited') Object.assign(filter, { isActive: true, mustSetPassword: true });
    if (search) {
      const rx = { $regex: escapeRegex(String(search)), $options: 'i' };
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }];
    }

    const staff = await User.find(filter)
      .select(STAFF_FIELDS)
      .populate('invitedBy', 'firstName lastName email')
      .sort({ createdAt: -1 })
      .limit(500);

    return sendResponse(res, HTTP_STATUS.OK, 'Staff loaded', {
      staff: staff.map((user) => serializeStaff(user, actorRole)),
      assignableRoles: getAssignableRoles(actorRole).map((value) => ({
        value,
        label: STAFF_ROLES[value].label,
        department: STAFF_ROLES[value].department,
      })),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/staff/invite — { name, email, role } */
export const inviteStaff = async (req, res, next) => {
  try {
    const { name, email, role } = req.body || {};
    if (!name?.trim() || !email?.trim() || !role) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'name, email and role are required');
    }
    if (!isStaffRole(role)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid role');
    if (!canManageRole(req.user.role, role)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You cannot invite someone with this role');
    }

    const normalizedEmail = email.trim().toLowerCase();
    if (await User.exists({ email: normalizedEmail })) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'An account with this email already exists');
    }

    const [firstName, ...rest] = name.trim().split(/\s+/);
    const lastName = rest.join(' ');
    const { rawToken, inviteTokenHash, inviteTokenExpiresAt } = createInviteToken();

    const user = await User.create({
      // User requires 2+ chars for both names; pad short ones rather than
      // reject a perfectly real name like "Al".
      firstName: firstName.length >= 2 ? firstName : `${firstName}.`,
      lastName: lastName.length >= 2 ? lastName : 'Team',
      email: normalizedEmail,
      // Unusable until the invitee sets their own via the link.
      password: crypto.randomBytes(24).toString('hex'),
      role,
      isEmailVerified: false,
      isActive: true,
      mustSetPassword: true,
      inviteTokenHash,
      inviteTokenExpiresAt,
      invitedBy: req.userId,
    });

    const delivery = await sendStaffInvite({ user, rawToken, invitedBy: req.user });

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.STAFF_INVITED,
      resourceType: 'staff',
      resourceId: String(user._id),
      metadata: { email: normalizedEmail, role },
    });

    await user.populate('invitedBy', 'firstName lastName email');
    return sendResponse(res, HTTP_STATUS.CREATED, 'Invitation sent', {
      staff: serializeStaff(user, req.user.role),
      ...delivery,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/staff/:id/resend-invite */
export const resendStaffInvite = async (req, res, next) => {
  try {
    const user = await loadManageableStaff(req, res);
    if (!user) return;
    if (!user.mustSetPassword) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'This person has already accepted the invite');
    }
    // The invite link would otherwise be a way back in for a suspended account.
    if (!user.isActive) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Restore access before resending the invite');
    }

    const { rawToken, inviteTokenHash, inviteTokenExpiresAt } = createInviteToken();
    user.inviteTokenHash = inviteTokenHash;
    user.inviteTokenExpiresAt = inviteTokenExpiresAt;
    user.$locals.skipPasswordHash = true;
    await user.save();

    const delivery = await sendStaffInvite({ user, rawToken, invitedBy: req.user });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.STAFF_INVITE_RESENT,
      resourceType: 'staff',
      resourceId: String(user._id),
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Invite resent', delivery);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/admin/staff/:id/role — { role } */
export const changeStaffRole = async (req, res, next) => {
  try {
    const { role } = req.body || {};
    if (!isStaffRole(role)) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid role');

    const user = await loadManageableStaff(req, res);
    if (!user) return;
    if (!canManageRole(req.user.role, role)) {
      return sendError(res, HTTP_STATUS.FORBIDDEN, 'You cannot assign this role');
    }
    if (role !== userRoleEnum.ADMIN && (await isLastActiveSuperAdmin(user))) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'The workspace needs at least one Super Admin',
      );
    }

    const previousRole = user.role;
    user.role = role;
    user.$locals.skipPasswordHash = true;
    await user.save();

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.STAFF_ROLE_CHANGED,
      resourceType: 'staff',
      resourceId: String(user._id),
      metadata: { from: previousRole, to: role, email: user.email },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Role updated', serializeStaff(user, req.user.role));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/admin/staff/:id/status — { isActive } */
export const setStaffStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body || {};
    if (typeof isActive !== 'boolean') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'isActive (boolean) is required');
    }
    const user = await loadManageableStaff(req, res);
    if (!user) return;
    if (!isActive && (await isLastActiveSuperAdmin(user))) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'The workspace needs at least one Super Admin',
      );
    }

    user.isActive = isActive;
    if (!isActive) {
      // An unused invite link must not outlive the suspension.
      user.inviteTokenHash = undefined;
      user.inviteTokenExpiresAt = undefined;
    }
    user.$locals.skipPasswordHash = true;
    await user.save();
    if (!isActive) await suspendAccount(user);

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.STAFF_STATUS_CHANGED,
      resourceType: 'staff',
      resourceId: String(user._id),
      metadata: { isActive, email: user.email },
    });
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      isActive ? 'Access restored' : 'Access suspended',
      serializeStaff(user, req.user.role),
    );
  } catch (error) {
    next(error);
  }
};

/**
 * DELETE /api/admin/staff/:id — revoke workspace access for good: the
 * account drops back to a regular app user and is deactivated, keeping the
 * row (and its audit trail) intact.
 */
export const removeStaff = async (req, res, next) => {
  try {
    const user = await loadManageableStaff(req, res);
    if (!user) return;
    if (await isLastActiveSuperAdmin(user)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'The workspace needs at least one Super Admin',
      );
    }

    const previousRole = user.role;
    user.role = userRoleEnum.USER;
    user.isActive = false;
    user.inviteTokenHash = undefined;
    user.inviteTokenExpiresAt = undefined;
    user.staffRemovedAt = new Date();
    user.$locals.skipPasswordHash = true;
    await user.save();
    await cancelPendingChangeRequests(user._id, 'Requester was removed from the workspace');
    await suspendAccount(user);

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.STAFF_REMOVED,
      resourceType: 'staff',
      resourceId: String(user._id),
      metadata: { role: previousRole, email: user.email },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Access removed');
  } catch (error) {
    next(error);
  }
};
