import AuditLog from '../models/AuditLog.js';
import logger from './logger.js';

/**
 * Canonical audit action names. Use these constants at call sites so the log
 * stays queryable and typo-free.
 */
export const AUDIT_ACTIONS = {
  USER_STATUS_CHANGED: 'user.status_changed',
  DOCTOR_INVITED: 'doctor.invited',
  DOCTOR_UPDATED: 'doctor.updated',
  DOCTOR_DEACTIVATED: 'doctor.deactivated',
  DOCTOR_INVITE_RESENT: 'doctor.invite_resent',
  CONTENT_CREATED: 'content.created',
  CONTENT_UPDATED: 'content.updated',
  CONTENT_VISIBILITY_CHANGED: 'content.visibility_changed',
  CONTENT_DELETED: 'content.deleted',
  SCHEME_CREATED: 'scheme.created',
  SCHEME_UPDATED: 'scheme.updated',
  SCHEME_DELETED: 'scheme.deleted',
  COMPANY_ASSET_UPLOADED: 'company_asset.uploaded',
  COMPANY_ASSET_UPDATED: 'company_asset.updated',
  COMPANY_ASSET_VISIBILITY_CHANGED: 'company_asset.visibility_changed',
  COMPANY_ASSET_DELETED: 'company_asset.deleted',
  COMPANY_FOLDER_CREATED: 'company_folder.created',
  COMPANY_FOLDER_UPDATED: 'company_folder.updated',
  COMPANY_FOLDER_DELETED: 'company_folder.deleted',
  ACCOUNT_DELETED: 'account.deleted',
  SUBSCRIPTION_SETTINGS_UPDATED: 'subscription_settings.updated',
  SUBSCRIPTION_FEATURE_CREATED: 'subscription_feature.created',
  SUBSCRIPTION_FEATURE_UPDATED: 'subscription_feature.updated',
  SUBSCRIPTION_FEATURE_DELETED: 'subscription_feature.deleted',
  SUBSCRIPTION_PLAN_CREATED: 'subscription_plan.created',
  SUBSCRIPTION_PLAN_UPDATED: 'subscription_plan.updated',
  SUBSCRIPTION_PLAN_DELETED: 'subscription_plan.deleted',
  COUPON_CREATED: 'coupon.created',
  COUPON_UPDATED: 'coupon.updated',
  COUPON_DELETED: 'coupon.deleted',
  PUSH_BROADCAST_CREATED: 'push_broadcast.created',
  PUSH_BROADCAST_CANCELLED: 'push_broadcast.cancelled',
  PUSH_BROADCAST_RETRIED: 'push_broadcast.retried',
  PUSH_TEST_SENT: 'push_test.sent',
  PUSH_SCHEDULE_CREATED: 'push_schedule.created',
  PUSH_SCHEDULE_UPDATED: 'push_schedule.updated',
  PUSH_SCHEDULE_PAUSED: 'push_schedule.paused',
  PUSH_SCHEDULE_RESUMED: 'push_schedule.resumed',
  PUSH_SCHEDULE_CANCELLED: 'push_schedule.cancelled',
  CMS_FEATURES_UPDATED: 'cms.features_updated',
  CMS_HOME_UPDATED: 'cms.home_updated',
  CMS_THEME_UPDATED: 'cms.theme_updated',
  CMS_BANNER_CREATED: 'cms.banner_created',
  CMS_BANNER_UPDATED: 'cms.banner_updated',
  CMS_BANNER_DELETED: 'cms.banner_deleted',
  CMS_TIP_CREATED: 'cms.cycle_tip_created',
  CMS_TIP_UPDATED: 'cms.cycle_tip_updated',
  CMS_TIP_DELETED: 'cms.cycle_tip_deleted',
  CMS_TIPS_SEEDED: 'cms.cycle_tips_seeded',
  CMS_ERA_UPDATED: 'cms.cycle_era_updated',
  CMS_ERA_RESET: 'cms.cycle_era_reset',
  CMS_SETTINGS_UPDATED: 'cms.settings_updated',
  CMS_REVISION_RESTORED: 'cms.revision_restored',
  CMS_LAUNCH_ANNOUNCED: 'cms.launch_announced',
  HR_MEMBER_CREATED: 'hr.member_created',
  HR_MEMBER_UPDATED: 'hr.member_updated',
  HR_MEMBER_DELETED: 'hr.member_deleted',
  HR_TEMPLATE_SAVED: 'hr.template_saved',
  HR_TEMPLATE_DELETED: 'hr.template_deleted',
  HR_DOCUMENT_CREATED: 'hr.document_created',
  HR_DOCUMENT_SENT: 'hr.document_sent',
  HR_DOCUMENT_REVOKED: 'hr.document_revoked',
  HR_DOCUMENT_SIGNED: 'hr.document_signed',
  CHANGE_REQUEST_CREATED: 'change_request.created',
  CHANGE_REQUEST_APPROVED: 'change_request.approved',
  CHANGE_REQUEST_REJECTED: 'change_request.rejected',
  CHANGE_REQUEST_CANCELLED: 'change_request.cancelled',
  STAFF_INVITED: 'staff.invited',
  STAFF_INVITE_RESENT: 'staff.invite_resent',
  STAFF_ROLE_CHANGED: 'staff.role_changed',
  STAFF_STATUS_CHANGED: 'staff.status_changed',
  STAFF_REMOVED: 'staff.removed',
};

/**
 * Record an audit entry. Best-effort: never throws and never blocks the main
 * request flow — a failed audit write is logged but not surfaced to the user.
 *
 * @param {object} params
 * @param {object} [params.req]          - Express request (for actor + ip).
 * @param {string} params.action         - One of AUDIT_ACTIONS.
 * @param {string} [params.resourceType]
 * @param {string} [params.resourceId]
 * @param {object} [params.metadata]     - Small, non-sensitive context only.
 */
export const recordAudit = async ({ req, action, resourceType, resourceId, metadata } = {}) => {
  try {
    await AuditLog.create({
      actorId: req?.userId || req?.user?._id,
      actorRole: req?.user?.role,
      action,
      resourceType,
      resourceId: resourceId != null ? String(resourceId) : undefined,
      metadata,
      ip: req?.ip,
    });
  } catch (error) {
    logger.error('audit_log_write_failed', {
      action: 'audit_log_write_failed',
      auditAction: action,
      error: error.message,
    });
  }
};
