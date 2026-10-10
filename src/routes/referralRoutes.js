import express from 'express';
import * as referrals from '../controllers/referralController.js';
import { authenticate } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';

/**
 * Clinical Admin: the gynac referral program — review referrals, manage
 * commission-free session credits and the program rules.
 * Mounted at /api/admin/referrals (before /api/admin in index.js). The
 * gynac's own side is in doctorRoutes.js (/api/doctor/referrals).
 */
const router = express.Router();

router.use(authenticate);

const read = requirePermission(PERMISSIONS.REFERRALS_READ);
const manage = requirePermission(PERMISSIONS.REFERRALS_MANAGE);

/**
 * @route   GET /api/admin/referrals/summary
 * @desc    Referral counts by status, free sessions granted / used / remaining, commission forgone
 * @access  Private (referrals.read)
 */
router.get('/summary', read, referrals.getReferralSummary);

/**
 * @route   GET /api/admin/referrals/settings
 * @desc    Referral program rules (on/off, sessions per referral, expiry, open-referral cap)
 * @access  Private (referrals.read)
 */
router.get('/settings', read, referrals.getSettings);

/**
 * @route   PUT /api/admin/referrals/settings
 * @desc    Change the referral program rules
 * @access  Private (referrals.manage)
 */
router.put('/settings', manage, referrals.updateSettings);

/**
 * @route   GET /api/admin/referrals/credits
 * @desc    Commission-free session credits (?doctorId=&status=&page=&limit=)
 * @access  Private (referrals.read)
 */
router.get('/credits', read, referrals.listCredits);

/**
 * @route   POST /api/admin/referrals/credits
 * @desc    Grant a gynac bonus commission-free sessions { doctorId, sessions, reason, expiryDays? }
 * @access  Private (referrals.manage)
 */
router.post('/credits', manage, referrals.grantBonusCredit);

/**
 * @route   POST /api/admin/referrals/credits/:id/revoke
 * @desc    Revoke a credit's unused sessions { reason }
 * @access  Private (referrals.manage)
 */
router.post('/credits/:id/revoke', manage, referrals.revokeCreditById);

/**
 * @route   GET /api/admin/referrals
 * @desc    Referrals (?status=&referrerId=&search=&page=&limit=)
 * @access  Private (referrals.read)
 */
router.get('/', read, referrals.listReferrals);

/**
 * @route   POST /api/admin/referrals
 * @desc    Record an offline referral: { referrerDoctorId, doctorId } for an invited gynac, or { referrerDoctorId, name, email } for a lead
 * @access  Private (referrals.manage)
 */
router.post('/', manage, referrals.createReferralByAdmin);

/**
 * @route   POST /api/admin/referrals/:id/approve
 * @desc    Approve a referral and invite the gynac { specialty, pricePerSession, ...invite fields }
 * @access  Private (referrals.manage)
 */
router.post('/:id/approve', manage, referrals.approveReferral);

/**
 * @route   POST /api/admin/referrals/:id/reject
 * @desc    Reject a referral in review { reason } (the referrer is told)
 * @access  Private (referrals.manage)
 */
router.post('/:id/reject', manage, referrals.rejectReferral);

/**
 * @route   POST /api/admin/referrals/:id/cancel
 * @desc    Close a referral in review or invited, without a reward { reason }
 * @access  Private (referrals.manage)
 */
router.post('/:id/cancel', manage, referrals.cancelReferral);

/**
 * @route   PATCH /api/admin/referrals/:id/referrer
 * @desc    Change who gets the reward, before the gynac joins { referrerDoctorId, reason? }
 * @access  Private (referrals.manage)
 */
router.patch('/:id/referrer', manage, referrals.reassignReferrer);

export default router;
