import express from 'express';
import { listAuditLogs } from '../controllers/auditController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';

const router = express.Router();

// Super Admin only — inspect privileged/security audit activity.
router.get('/', authenticate, requirePermission(PERMISSIONS.AUDIT_READ), listAuditLogs);

export default router;
