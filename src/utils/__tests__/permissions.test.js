import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONS as P,
  STAFF_ROLES,
  canApproveDepartment,
  canManageRole,
  getAssignableRoles,
  hasPermission,
  isStaffRole,
} from '../../config/permissions.js';

test('Super Admin holds every permission', () => {
  for (const permission of Object.values(P)) assert.ok(hasPermission('admin', permission));
});

test('app users, partners and doctors are not staff', () => {
  for (const role of ['user', 'partner', 'doctor', undefined, 'nope']) {
    assert.equal(isStaffRole(role), false);
    assert.equal(hasPermission(role, P.CONTENT_READ), false);
  }
});

test('Content Admin can draft but not publish or approve', () => {
  assert.ok(hasPermission('content_admin', P.CONTENT_WRITE));
  assert.equal(hasPermission('content_admin', P.CONTENT_PUBLISH), false);
  assert.equal(hasPermission('content_admin', P.CONTENT_APPROVE), false);
  assert.equal(hasPermission('content_admin', P.USERS_READ), false);
});

test('departments are isolated', () => {
  assert.equal(hasPermission('content_super_admin', P.PUSH_SEND), false);
  assert.equal(hasPermission('app_super_admin', P.CONTENT_WRITE), false);
  assert.equal(hasPermission('clinical_admin', P.USERS_READ), false);
  assert.equal(hasPermission('app_admin', P.AUDIT_READ), false);
});

test('role hierarchy: managers only manage lower levels of their own department', () => {
  assert.ok(canManageRole('content_super_admin', 'content_admin'));
  assert.equal(canManageRole('content_super_admin', 'content_super_admin'), false);
  assert.equal(canManageRole('content_super_admin', 'app_admin'), false);
  assert.equal(canManageRole('content_admin', 'content_admin'), false);
  assert.equal(canManageRole('app_super_admin', 'admin'), false);
  assert.equal(canManageRole('clinical_admin', 'clinical_admin'), false);
  assert.ok(canManageRole('admin', 'admin'));
  assert.ok(canManageRole('admin', 'clinical_admin'));
  assert.equal(canManageRole('admin', 'doctor'), false);
});

test('assignable roles follow the hierarchy', () => {
  assert.deepEqual(getAssignableRoles('content_super_admin'), ['content_admin']);
  assert.deepEqual(getAssignableRoles('app_super_admin'), ['app_admin']);
  assert.deepEqual(getAssignableRoles('content_admin'), []);
  assert.equal(getAssignableRoles('admin').length, 6);
});

test('approvers are scoped to their department', () => {
  assert.ok(canApproveDepartment('content_super_admin', 'content'));
  assert.equal(canApproveDepartment('content_super_admin', 'app'), false);
  assert.ok(canApproveDepartment('app_super_admin', 'app'));
  assert.equal(canApproveDepartment('app_admin', 'app'), false);
  assert.ok(canApproveDepartment('admin', 'content'));
  assert.ok(canApproveDepartment('admin', 'app'));
});

test('doctor commission & payouts: only Super Admin and Clinical Admin', () => {
  const holders = Object.keys(STAFF_ROLES).filter(
    (role) => hasPermission(role, P.PAYOUTS_READ) || hasPermission(role, P.PAYOUTS_MANAGE),
  );
  assert.deepEqual(holders.sort(), ['admin', 'clinical_admin']);
  for (const role of holders) assert.ok(hasPermission(role, P.PAYOUTS_MANAGE));
});
