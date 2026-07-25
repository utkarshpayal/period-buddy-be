import express from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import * as reportController from '../controllers/reportController.js';

const router = express.Router();

router.use(authenticate);

router.post('/health-report', reportController.getHealthReport);

export default router;
