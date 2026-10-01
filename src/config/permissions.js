import { userRoleEnum } from '../enums/enums.js';

/**
 * Role-based access control for the Admin Workspace.
 *
 * Routes gate on *permissions* (requirePermission in middleware/rbac.js), never
 * on role strings, so adding or reshaping a role is a change to this file only.
 *
 * Two permission tiers exist for approval-gated actions:
 *   - `x.write` / `x.send` — may prepare the change (a Content Admin editing a
 *     draft, an App Admin composing a push).
 *   - `x.publish` / `x.manage` / `x.broadcast` — may apply it directly. A
 *     holder of only the lower tier gets a ChangeRequest instead (see
 *     middleware/approvalGate.js) that an approver for that department applies.
 */
export const PERMISSIONS = {
  // Content (blogs, Q&A, reels, guides, health issues, govt. schemes)
  CONTENT_READ: 'content.read',
  CONTENT_WRITE: 'content.write',
  CONTENT_PUBLISH: 'content.publish',
  CONTENT_APPROVE: 'content.approve',

  // App & Growth
  USERS_READ: 'users.read',
  USERS_MANAGE: 'users.manage',
  PUSH_READ: 'push.read',
  PUSH_SEND: 'push.send',
  PUSH_BROADCAST: 'push.broadcast',
  ANALYTICS_READ: 'analytics.read',
  SUBSCRIPTIONS_READ: 'subscriptions.read',
  SUBSCRIPTIONS_WRITE: 'subscriptions.write',
  SUBSCRIPTIONS_MANAGE: 'subscriptions.manage',
  SCHEME_APPLICATIONS_READ: 'scheme_applications.read',
  SCHEME_APPLICATIONS_REVIEW: 'scheme_applications.review',
  MARKETING_READ: 'marketing.read',
  APP_APPROVE: 'app.approve',
  // App CMS (The-Nura-CMS): features, home layout, banners, theme
  CMS_READ: 'cms.read',
  CMS_MANAGE: 'cms.manage',

  // Clinical
  DOCTORS_READ: 'doctors.read',
  DOCTORS_MANAGE: 'doctors.manage',
  // Doctor commission, earnings ledger and wallet withdrawals
  PAYOUTS_READ: 'payouts.read',
  PAYOUTS_MANAGE: 'payouts.manage',

  // Organisation
  STAFF_MANAGE: 'staff.manage',
  AUDIT_READ: 'audit.read',
  COMPANY_FILES_MANAGE: 'company_files.manage',
  // People & letters: team member records, HR templates, offer letters, e-signing
  HR_MANAGE: 'hr.manage',
};

const ALL = Object.values(PERMISSIONS);
const P = PERMISSIONS;

export const DEPARTMENTS = {
  ORGANISATION: 'organisation',
  CONTENT: 'content',
  APP: 'app',
  CLINICAL: 'clinical',
};

/**
 * Staff roles only. `level` 1 is the top; a manager may only invite/manage
 * roles in their own department with a strictly higher level number.
 */
export const STAFF_ROLES = {
  [userRoleEnum.ADMIN]: {
    label: 'Super Admin',
    department: DEPARTMENTS.ORGANISATION,
    level: 1,
    permissions: ALL,
  },
  [userRoleEnum.CONTENT_SUPER_ADMIN]: {
    label: 'Content Super Admin',
    department: DEPARTMENTS.CONTENT,
    level: 2,
    permissions: [
      P.CONTENT_READ,
      P.CONTENT_WRITE,
      P.CONTENT_PUBLISH,
      P.CONTENT_APPROVE,
      P.STAFF_MANAGE,
    ],
  },
  [userRoleEnum.CONTENT_ADMIN]: {
    label: 'Content Admin',
    department: DEPARTMENTS.CONTENT,
    level: 3,
    permissions: [P.CONTENT_READ, P.CONTENT_WRITE],
  },
  [userRoleEnum.APP_SUPER_ADMIN]: {
    label: 'App Super Admin',
    department: DEPARTMENTS.APP,
    level: 2,
    permissions: [
      P.USERS_READ,
      P.USERS_MANAGE,
      P.PUSH_READ,
      P.PUSH_SEND,
      P.PUSH_BROADCAST,
      P.ANALYTICS_READ,
      P.SUBSCRIPTIONS_READ,
      P.SUBSCRIPTIONS_WRITE,
      P.SUBSCRIPTIONS_MANAGE,
      P.SCHEME_APPLICATIONS_READ,
      P.SCHEME_APPLICATIONS_REVIEW,
      P.MARKETING_READ,
      P.APP_APPROVE,
      P.CMS_READ,
      P.CMS_MANAGE,
      P.STAFF_MANAGE,
    ],
  },
  [userRoleEnum.APP_ADMIN]: {
    label: 'App Admin',
    department: DEPARTMENTS.APP,
    level: 3,
    permissions: [
      P.USERS_READ,
      P.PUSH_READ,
      P.PUSH_SEND,
      P.ANALYTICS_READ,
      P.SUBSCRIPTIONS_READ,
      P.SUBSCRIPTIONS_WRITE,
      P.SCHEME_APPLICATIONS_READ,
      P.SCHEME_APPLICATIONS_REVIEW,
      P.MARKETING_READ,
      P.CMS_READ,
    ],
  },
  [userRoleEnum.CLINICAL_ADMIN]: {
    label: 'Clinical Admin',
    department: DEPARTMENTS.CLINICAL,
    level: 2,
    permissions: [P.DOCTORS_READ, P.DOCTORS_MANAGE, P.PAYOUTS_READ, P.PAYOUTS_MANAGE],
  },
};

/** Which permission lets a user approve a department's change requests. */
export const APPROVE_PERMISSION_BY_DEPARTMENT = {
  [DEPARTMENTS.CONTENT]: P.CONTENT_APPROVE,
  [DEPARTMENTS.APP]: P.APP_APPROVE,
};

export const isStaffRole = (role) => Object.hasOwn(STAFF_ROLES, role);

export const getPermissions = (role) => STAFF_ROLES[role]?.permissions ?? [];

export const hasPermission = (role, permission) => getPermissions(role).includes(permission);

export const hasAnyPermission = (role, permissions) =>
  permissions.some((permission) => hasPermission(role, permission));

/**
 * Can `actorRole` invite / suspend / re-role a staff member holding
 * `targetRole`? Super Admin manages everyone (including other Super Admins);
 * a department manager only manages lower levels of their own department.
 */
export const canManageRole = (actorRole, targetRole) => {
  const actor = STAFF_ROLES[actorRole];
  const target = STAFF_ROLES[targetRole];
  if (!actor || !target) return false;
  if (actorRole === userRoleEnum.ADMIN) return true;
  if (!actor.permissions.includes(P.STAFF_MANAGE)) return false;
  return actor.department === target.department && target.level > actor.level;
};

/** Roles `actorRole` may assign, for the invite form's role picker. */
export const getAssignableRoles = (actorRole) =>
  Object.keys(STAFF_ROLES).filter((role) => canManageRole(actorRole, role));

/** Can `role` review a change request raised in `department`? */
export const canApproveDepartment = (role, department) => {
  const permission = APPROVE_PERMISSION_BY_DEPARTMENT[department];
  return Boolean(permission) && hasPermission(role, permission);
};

/** Public, serialisable description of a user's access — sent on login/me. */
export const describeAccess = (role) => {
  const meta = STAFF_ROLES[role];
  return {
    role,
    roleLabel: meta?.label ?? null,
    department: meta?.department ?? null,
    level: meta?.level ?? null,
    permissions: getPermissions(role),
    assignableRoles: getAssignableRoles(role),
  };
};
