import User from '../models/User.js';
import Doctor from '../models/Doctor.js';
import Consultation from '../models/Consultation.js';
import GovernmentBenefit from '../models/GovernmentBenefit.js';
import Blog from '../models/Blog.js';
import Reel from '../models/Reel.js';
import Document from '../models/Document.js';
import CycleLog from '../models/CycleLog.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  getPagination,
  buildPagination,
  escapeRegex,
  isValidObjectId,
} from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { userRoleEnum } from '../enums/enums.js';
import logger from '../utils/logger.js';

// Safe, non-sensitive projection for user listings/detail. Sensitive fields
// (password, OTP hashes, invite tokens) are already `select: false` on the
// schema; we additionally omit push tokens and other noise.
const USER_LIST_FIELDS =
  'firstName lastName email phone role isActive isEmailVerified authProvider ' +
  'subscriptionPlan country state language lastLogin createdAt deletedAt profilePicture';

/**
 * GET /api/admin/users — Super Admin: paginated, searchable, filterable user
 * directory. Never returns health data — only account metadata.
 * Query: ?search= &role= &status=active|suspended &page= &limit=
 */
export const listUsers = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const filter = {};

    const { search, role, status } = req.query;

    if (search) {
      const rx = new RegExp(escapeRegex(String(search).trim()), 'i');
      filter.$or = [{ firstName: rx }, { lastName: rx }, { email: rx }, { phone: rx }];
    }
    if (role && Object.values(userRoleEnum).includes(role)) {
      filter.role = role;
    }
    if (status === 'active') filter.isActive = true;
    else if (status === 'suspended') filter.isActive = false;

    const [users, total] = await Promise.all([
      User.find(filter)
        .select(USER_LIST_FIELDS)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      User.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Users fetched', {
      users,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/users/:id — Super Admin: a single user's account profile plus
 * coarse *activity counts* only. Deliberately never returns the contents of
 * cycle logs, documents, or consultations — just how many exist — so admin
 * oversight doesn't become a health-data leak.
 */
export const getUser = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid user id');
    }

    const user = await User.findById(req.params.id).select(USER_LIST_FIELDS).lean();
    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'User not found');

    const [cycleLogs, documents, consultations] = await Promise.all([
      CycleLog.countDocuments({ userId: user._id }),
      Document.countDocuments({ userId: user._id }),
      Consultation.countDocuments({ userId: user._id }),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'User fetched', {
      user,
      activity: { cycleLogs, documents, consultations },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/admin/users/:id/status — Super Admin: activate or suspend an
 * account. Suspending flips isActive=false, which the auth middleware already
 * treats as "no access" on the next request. Audit-logged.
 */
export const setUserStatus = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid user id');
    }
    const { isActive } = req.body;
    if (typeof isActive !== 'boolean') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'isActive (boolean) is required');
    }

    // An admin can't suspend their own account (would lock themselves out).
    if (String(req.params.id) === String(req.userId) && isActive === false) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'You cannot suspend your own account');
    }

    const user = await User.findByIdAndUpdate(
      req.params.id,
      { isActive },
      { new: true, runValidators: true },
    ).select(USER_LIST_FIELDS);

    if (!user) return sendError(res, HTTP_STATUS.NOT_FOUND, 'User not found');

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.USER_STATUS_CHANGED,
      resourceType: 'user',
      resourceId: user._id,
      metadata: { isActive, email: user.email, role: user.role },
    });

    logger.info('admin_user_status_changed', {
      action: 'admin_user_status_changed',
      adminId: req.userId,
      targetUserId: user._id,
      isActive,
    });

    return sendResponse(res, HTTP_STATUS.OK, isActive ? 'User activated' : 'User suspended', {
      user,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/admin/analytics — Super Admin: platform-wide operational metrics.
 * Aggregate counts only — no personally identifying or health data.
 */
export const getAnalytics = async (req, res, next) => {
  try {
    const now = Date.now();
    const last7 = new Date(now - 7 * 24 * 60 * 60 * 1000);
    const last30 = new Date(now - 30 * 24 * 60 * 60 * 1000);

    const [
      totalUsers,
      activeUsers,
      usersByRole,
      newUsers7,
      newUsers30,
      totalDoctors,
      activeDoctors,
      consultationsByStatus,
      revenueAgg,
      totalSchemes,
      activeSchemes,
      totalBlogs,
      totalReels,
    ] = await Promise.all([
      User.countDocuments({}),
      User.countDocuments({ isActive: true }),
      User.aggregate([{ $group: { _id: '$role', count: { $sum: 1 } } }]),
      User.countDocuments({ createdAt: { $gte: last7 } }),
      User.countDocuments({ createdAt: { $gte: last30 } }),
      Doctor.countDocuments({}),
      Doctor.countDocuments({ isAvailable: true }),
      Consultation.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Consultation.aggregate([
        { $match: { paymentStatus: 'paid' } },
        { $group: { _id: null, total: { $sum: '$amountPaid' } } },
      ]),
      GovernmentBenefit.countDocuments({}),
      GovernmentBenefit.countDocuments({ status: 'active' }),
      Blog.countDocuments({}),
      Reel.countDocuments({}),
    ]);

    const roleMap = usersByRole.reduce((acc, r) => ({ ...acc, [r._id || 'unknown']: r.count }), {});
    const consultationMap = consultationsByStatus.reduce(
      (acc, r) => ({ ...acc, [r._id || 'unknown']: r.count }),
      {},
    );

    return sendResponse(res, HTTP_STATUS.OK, 'Analytics fetched', {
      users: {
        total: totalUsers,
        active: activeUsers,
        suspended: totalUsers - activeUsers,
        byRole: roleMap,
        newLast7Days: newUsers7,
        newLast30Days: newUsers30,
      },
      doctors: { total: totalDoctors, active: activeDoctors },
      consultations: {
        byStatus: consultationMap,
        revenue: revenueAgg[0]?.total || 0,
      },
      schemes: { total: totalSchemes, active: activeSchemes },
      content: { blogs: totalBlogs, reels: totalReels },
      generatedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
};
