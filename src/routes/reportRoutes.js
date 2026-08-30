import express from 'express';
import { authenticate } from '../middleware/authMiddleware.js';
import * as reportController from '../controllers/reportController.js';

const router = express.Router();

router.use(authenticate);

// Intentionally NOT gated behind 'health_reports' at the route level: this
// one endpoint also backs the free Graphs & Reports dashboard (cycle
// length/weight/temperature/water/sleep trends), not just the downloadable
// doctor PDF — locking it here would take core tracking behind a paywall.
// The 'health_reports' feature is still admin-priceable; the app enforces it
// client-side by gating only the "Download doctor report" PDF action, not
// this shared data call (see period-buddy's app/(app)/documents.tsx).
router.post('/health-report', reportController.getHealthReport);

export default router;
