import express from 'express';
import * as adminController from '../controllers/adminController.js';
import * as adminNotificationController from '../controllers/adminNotificationController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Every route here is Super Admin only.
router.use(authenticate, authorize('admin'));

router.get('/analytics', adminController.getAnalytics);
router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUser);
router.patch('/users/:id/status', adminController.setUserStatus);

// Push notification broadcasts (batched background send — see
// utils/pushBroadcastWorker.js).
router.get('/notifications/audience', adminNotificationController.getAudienceCount);
router.get('/notifications/recipients', adminNotificationController.searchRecipients);
router.post('/notifications/test', adminNotificationController.sendTestNotification);
router.get('/notifications/broadcasts', adminNotificationController.listBroadcasts);
router.post('/notifications/broadcasts', adminNotificationController.createBroadcast);
router.get('/notifications/broadcasts/:id', adminNotificationController.getBroadcast);
router.post('/notifications/broadcasts/:id/cancel', adminNotificationController.cancelBroadcast);
router.post('/notifications/broadcasts/:id/retry', adminNotificationController.retryBroadcast);

export default router;
