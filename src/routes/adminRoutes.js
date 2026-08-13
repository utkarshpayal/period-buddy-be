import express from 'express';
import * as adminController from '../controllers/adminController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Every route here is Super Admin only.
router.use(authenticate, authorize('admin'));

router.get('/analytics', adminController.getAnalytics);
router.get('/users', adminController.listUsers);
router.get('/users/:id', adminController.getUser);
router.patch('/users/:id/status', adminController.setUserStatus);

export default router;
