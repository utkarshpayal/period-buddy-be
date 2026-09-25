import express from 'express';
import * as adminController from '../controllers/subscriptionAdminController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { withApproval } from '../middleware/approvalGate.js';
import { PERMISSIONS as P, DEPARTMENTS } from '../config/permissions.js';

const router = express.Router();

router.use(authenticate, requirePermission(P.SUBSCRIPTIONS_READ));

const canWrite = requirePermission(P.SUBSCRIPTIONS_WRITE);

// Every pricing / paywall change touches revenue, so App Admins propose and
// an App Super Admin applies.
const gated = (key, action, resourceType, describe, handler) => [
  canWrite,
  withApproval(
    {
      key,
      directPermission: P.SUBSCRIPTIONS_MANAGE,
      department: DEPARTMENTS.APP,
      action,
      resourceType,
      summarize: describe,
    },
    handler,
  ),
];

const label = (req) => req.body?.name || req.body?.code || req.body?.key || req.params.id || '';

router.get('/settings', adminController.getSubscriptionSettings);
router.put(
  '/settings',
  ...gated(
    'subscriptions.settings',
    'pricing_change',
    'subscription_settings',
    (req) =>
      typeof req.body?.subscriptionEnabled === 'boolean'
        ? `Turn subscriptions ${req.body.subscriptionEnabled ? 'on' : 'off'}`
        : 'Update subscription settings',
    adminController.updateSubscriptionSettings,
  ),
);

router.get('/features', adminController.adminListFeatures);
router.post(
  '/features',
  ...gated(
    'subscriptions.feature.create',
    'create',
    'subscription_feature',
    (req) => `Add feature ${label(req)}`,
    adminController.createFeature,
  ),
);
router.patch(
  '/features/:id',
  ...gated(
    'subscriptions.feature.update',
    'pricing_change',
    'subscription_feature',
    (req) => `Update feature ${label(req)}`,
    adminController.updateFeature,
  ),
);
router.delete(
  '/features/:id',
  ...gated(
    'subscriptions.feature.delete',
    'delete',
    'subscription_feature',
    () => 'Delete a feature',
    adminController.deleteFeature,
  ),
);

router.get('/plans', adminController.adminListPlans);
router.post(
  '/plans',
  ...gated(
    'subscriptions.plan.create',
    'create',
    'subscription_plan',
    (req) => `Add plan ${label(req)}`,
    adminController.createPlan,
  ),
);
router.patch(
  '/plans/:id',
  ...gated(
    'subscriptions.plan.update',
    'pricing_change',
    'subscription_plan',
    (req) => `Update plan ${label(req)}`,
    adminController.updatePlan,
  ),
);
router.delete(
  '/plans/:id',
  ...gated(
    'subscriptions.plan.delete',
    'delete',
    'subscription_plan',
    () => 'Delete a plan',
    adminController.deletePlan,
  ),
);

router.get('/coupons', adminController.adminListCoupons);
router.post(
  '/coupons',
  ...gated(
    'subscriptions.coupon.create',
    'create',
    'coupon',
    (req) => `Add coupon ${label(req)}`,
    adminController.createCoupon,
  ),
);
router.patch(
  '/coupons/:id',
  ...gated(
    'subscriptions.coupon.update',
    'pricing_change',
    'coupon',
    (req) => `Update coupon ${label(req)}`,
    adminController.updateCoupon,
  ),
);
router.delete(
  '/coupons/:id',
  ...gated(
    'subscriptions.coupon.delete',
    'delete',
    'coupon',
    () => 'Delete a coupon',
    adminController.deleteCoupon,
  ),
);

router.get('/overview', adminController.getOverview);

export default router;
