import express from 'express';
import * as forestController from '../controllers/forestController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

router.get('/status', authenticate, forestController.getForestStatus);
router.post('/care', authenticate, forestController.logForestCare);
router.get('/logs', authenticate, forestController.getForestLogs);

export default router;
