import express from 'express';
import { listAuditLogs } from '../controllers/auditController.js';
import { authenticate, authorize } from '../middleware/authMiddleware.js';

const router = express.Router();

// Super Admin only — inspect privileged/security audit activity.
router.get('/', authenticate, authorize('admin'), listAuditLogs);

export default router;
