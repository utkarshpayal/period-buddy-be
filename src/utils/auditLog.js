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
