import express from 'express';
import * as adminController from '../controllers/subscriptionAdminController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Every route here is Super Admin only — mirrors adminRoutes.js.
router.use(authenticate, authorize('admin'));

router.get('/settings', adminController.getSubscriptionSettings);
router.put('/settings', adminController.updateSubscriptionSettings);

router.get('/features', adminController.adminListFeatures);
router.post('/features', adminController.createFeature);
router.patch('/features/:id', adminController.updateFeature);
router.delete('/features/:id', adminController.deleteFeature);

router.get('/plans', adminController.adminListPlans);
router.post('/plans', adminController.createPlan);
router.patch('/plans/:id', adminController.updatePlan);
router.delete('/plans/:id', adminController.deletePlan);

router.get('/coupons', adminController.adminListCoupons);
router.post('/coupons', adminController.createCoupon);
router.patch('/coupons/:id', adminController.updateCoupon);
router.delete('/coupons/:id', adminController.deleteCoupon);

router.get('/overview', adminController.getOverview);

export default router;
