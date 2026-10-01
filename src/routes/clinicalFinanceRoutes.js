import express from 'express';
import * as finance from '../controllers/clinicalFinanceController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';

/**
 * Clinical Admin: doctor commission, earnings ledger and payouts.
 * Mounted at /api/admin/clinical-finance (before /api/admin in index.js).
 */
const router = express.Router();

router.use(authenticate);

const read = requirePermission(PERMISSIONS.PAYOUTS_READ);
const manage = requirePermission(PERMISSIONS.PAYOUTS_MANAGE);

/**
 * @route   GET /api/admin/clinical-finance/overview
 * @desc    Platform totals: gross, commission, owed to doctors, paid out, queue
 * @access  Private (payouts.read)
 */
router.get('/overview', read, finance.getOverview);

/**
 * @route   GET /api/admin/clinical-finance/settings
 * @desc    Commission and withdrawal rules
 * @access  Private (payouts.read)
 */
router.get('/settings', read, finance.getSettings);

/**
 * @route   PUT /api/admin/clinical-finance/settings
 * @desc    Change the default commission, hold period, withdrawal limits and switches
 * @access  Private (payouts.manage)
 */
router.put('/settings', manage, finance.updateSettings);

/**
 * @route   GET /api/admin/clinical-finance/doctors
 * @desc    Doctors with their commission rate and wallet balances
 * @access  Private (payouts.read)
 */
router.get('/doctors', read, finance.listDoctorWallets);

/**
 * @route   PATCH /api/admin/clinical-finance/doctors/:id/commission
 * @desc    Set or clear a doctor's commission override
 * @access  Private (payouts.manage)
 */
router.patch('/doctors/:id/commission', manage, finance.setDoctorCommission);

/**
 * @route   GET /api/admin/clinical-finance/earnings
 * @desc    Earnings ledger (per session gross / commission / net, and adjustments)
 * @access  Private (payouts.read)
 */
router.get('/earnings', read, finance.listEarnings);

/**
 * @route   POST /api/admin/clinical-finance/earnings/:id/reverse
 * @desc    Reverse an earning (e.g. the patient was refunded)
 * @access  Private (payouts.manage)
 */
router.post('/earnings/:id/reverse', manage, finance.reverseEarningById);

/**
 * @route   POST /api/admin/clinical-finance/adjustments
 * @desc    Credit or debit a doctor's wallet with a note
 * @access  Private (payouts.manage)
 */
router.post('/adjustments', manage, finance.addAdjustment);

/**
 * @route   GET /api/admin/clinical-finance/payouts
 * @desc    Withdrawal requests and their Cashfree status
 * @access  Private (payouts.read)
 */
router.get('/payouts', read, finance.listPayouts);

/**
 * @route   POST /api/admin/clinical-finance/payouts/:id/approve
 * @desc    Approve a withdrawal and send it via Cashfree Payouts
 * @access  Private (payouts.manage)
 */
router.post('/payouts/:id/approve', manage, finance.approvePayoutById);

/**
 * @route   POST /api/admin/clinical-finance/payouts/:id/reject
 * @desc    Decline a withdrawal; the amount returns to the doctor's wallet
 * @access  Private (payouts.manage)
 */
router.post('/payouts/:id/reject', manage, finance.rejectPayoutById);

/**
 * @route   POST /api/admin/clinical-finance/payouts/:id/sync
 * @desc    Check a withdrawal's status with Cashfree now
 * @access  Private (payouts.manage)
 */
router.post('/payouts/:id/sync', manage, finance.syncPayoutById);

/**
 * @route   POST /api/admin/clinical-finance/payouts/:id/mark-paid
 * @desc    Record a manual withdrawal as paid, with the bank reference / UTR
 * @access  Private (payouts.manage)
 */
router.post('/payouts/:id/mark-paid', manage, finance.markPayoutPaidById);

/**
 * @route   GET /api/admin/clinical-finance/payouts/:id/method
 * @desc    Full bank account / UPI details to pay a withdrawal by hand (audited)
 * @access  Private (payouts.manage)
 */
router.get('/payouts/:id/method', manage, finance.getPayoutMethodById);

export default router;
