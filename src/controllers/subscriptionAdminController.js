import SubscriptionFeature from '../models/SubscriptionFeature.js';
import SubscriptionPlan from '../models/SubscriptionPlan.js';
import Entitlement from '../models/Entitlement.js';
import Coupon from '../models/Coupon.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  getPagination,
  buildPagination,
  escapeRegex,
  isPaginatedRequest,
  pickDefined,
  isValidObjectId,
  sendPaginatedList,
} from '../utils/apiHelpers.js';
import { getSettings } from '../utils/subscriptionAccess.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import logger from '../utils/logger.js';

/* ------------------------------ Settings ------------------------------ */

const SETTINGS_FIELDS = [
  'subscriptionEnabled',
  'currency',
  'allowFeatureWisePurchase',
  'graceDays',
];

/** GET /api/admin/subscriptions/settings */
export const getSubscriptionSettings = async (req, res, next) => {
  try {
    const settings = await getSettings();
    return sendResponse(res, HTTP_STATUS.OK, 'Settings fetched', settings);
  } catch (error) {
    next(error);
  }
};

/** PUT /api/admin/subscriptions/settings — the global on/off switch + currency + à la carte toggle. */
export const updateSubscriptionSettings = async (req, res, next) => {
  try {
    const updates = pickDefined(req.body, SETTINGS_FIELDS);
    const settings = await getSettings();
    Object.assign(settings, updates);
    await settings.save();

    logger.info(`Admin ${req.user?._id} updated subscription settings`, {
      action: 'subscription_settings_updated',
      updates,
    });
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.SUBSCRIPTION_SETTINGS_UPDATED,
      resourceType: 'subscription_settings',
      resourceId: settings._id,
      metadata: updates,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Settings updated', settings);
  } catch (error) {
    next(error);
  }
};

/* ------------------------------ Features ------------------------------- */

const FEATURE_FIELDS = [
  'key',
  'name',
  'description',
  'category',
  'icon',
  'isPremium',
  'price',
  'billingCycle',
  'isActive',
  'sortOrder',
];

/** GET /api/admin/subscriptions/features — full catalog incl. inactive. */
export const adminListFeatures = async (req, res, next) => {
  try {
    const features = await SubscriptionFeature.find().sort({ category: 1, sortOrder: 1 });
    return sendResponse(res, HTTP_STATUS.OK, 'Features fetched', features);
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/subscriptions/features */
export const createFeature = async (req, res, next) => {
  try {
    const payload = pickDefined(req.body, FEATURE_FIELDS);
    if (!payload.key || !String(payload.key).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A feature key is required');
    }
    if (!payload.name || !String(payload.name).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A feature name is required');
    }
    payload.key = String(payload.key).trim().toLowerCase();

    const existing = await SubscriptionFeature.findOne({ key: payload.key });
    if (existing) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        `A feature with key "${payload.key}" already exists`,
      );
    }

    const feature = await SubscriptionFeature.create(payload);
    logger.info(`Admin ${req.user?._id} created subscription feature ${feature.key}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.SUBSCRIPTION_FEATURE_CREATED,
      resourceType: 'subscription_feature',
      resourceId: feature._id,
      metadata: { key: feature.key, isPremium: feature.isPremium, price: feature.price },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Feature created', feature);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/admin/subscriptions/features/:id — including the Free/Premium
 * toggle and per-feature fee that this whole system exists for. */
export const updateFeature = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Feature not found');
    }
    const feature = await SubscriptionFeature.findById(req.params.id);
    if (!feature) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Feature not found');

    const updates = pickDefined(req.body, FEATURE_FIELDS);
    if (updates.key !== undefined) {
      updates.key = String(updates.key).trim().toLowerCase();
      const clash = await SubscriptionFeature.findOne({
        key: updates.key,
        _id: { $ne: feature._id },
      });
      if (clash) {
        return sendError(
          res,
          HTTP_STATUS.CONFLICT,
          `A feature with key "${updates.key}" already exists`,
        );
      }
    }
    if (updates.name !== undefined && !String(updates.name).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Feature name cannot be empty');
    }

    Object.assign(feature, updates);
    await feature.save();

    logger.info(`Admin ${req.user?._id} updated subscription feature ${feature.key}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.SUBSCRIPTION_FEATURE_UPDATED,
      resourceType: 'subscription_feature',
      resourceId: feature._id,
      metadata: { fields: Object.keys(updates) },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Feature updated', feature);
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/admin/subscriptions/features/:id */
export const deleteFeature = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Feature not found');
    }
    const feature = await SubscriptionFeature.findByIdAndDelete(req.params.id);
    if (!feature) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Feature not found');

    // Not a referential-integrity hard-stop: plans that listed this key just
    // stop granting it (subscriptionAccess.js only ever unions live keys),
    // and past Entitlements keep their historical featureKey for reporting.
    logger.info(`Admin ${req.user?._id} deleted subscription feature ${feature.key}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.SUBSCRIPTION_FEATURE_DELETED,
      resourceType: 'subscription_feature',
      resourceId: req.params.id,
      metadata: { key: feature.key },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Feature deleted', { success: true });
  } catch (error) {
    next(error);
  }
};

/* -------------------------------- Plans -------------------------------- */

const PLAN_FIELDS = [
  'name',
  'slug',
  'description',
  'price',
  'billingCycle',
  'features',
  'isDefault',
  'isActive',
  'sortOrder',
  'badge',
];

const slugify = (value) =>
  String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** GET /api/admin/subscriptions/plans — full catalog incl. inactive. */
export const adminListPlans = async (req, res, next) => {
  try {
    const plans = await SubscriptionPlan.find().sort({ sortOrder: 1 });
    return sendResponse(res, HTTP_STATUS.OK, 'Plans fetched', plans);
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/subscriptions/plans */
export const createPlan = async (req, res, next) => {
  try {
    const payload = pickDefined(req.body, PLAN_FIELDS);
    if (!payload.name || !String(payload.name).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A plan name is required');
    }
    if (payload.price === undefined || payload.price < 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid price is required');
    }

    const slug = slugify(payload.slug || payload.name);
    let attempt = slug;
    let n = 1;
    while (await SubscriptionPlan.findOne({ slug: attempt })) {
      attempt = `${slug}-${++n}`;
    }
    payload.slug = attempt;

    const plan = await SubscriptionPlan.create(payload);
    logger.info(`Admin ${req.user?._id} created subscription plan ${plan.slug}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_CREATED,
      resourceType: 'subscription_plan',
      resourceId: plan._id,
      metadata: { slug: plan.slug, price: plan.price, features: plan.features },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Plan created', plan);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/admin/subscriptions/plans/:id */
export const updatePlan = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Plan not found');
    }
    const plan = await SubscriptionPlan.findById(req.params.id);
    if (!plan) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Plan not found');

    const updates = pickDefined(req.body, PLAN_FIELDS);
    if (updates.name !== undefined && !String(updates.name).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Plan name cannot be empty');
    }
    if (req.body.slug) {
      const slug = slugify(req.body.slug);
      let attempt = slug;
      let n = 1;
      while (await SubscriptionPlan.findOne({ slug: attempt, _id: { $ne: plan._id } })) {
        attempt = `${slug}-${++n}`;
      }
      updates.slug = attempt;
    }

    Object.assign(plan, updates);
    await plan.save();

    logger.info(`Admin ${req.user?._id} updated subscription plan ${plan.slug}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_UPDATED,
      resourceType: 'subscription_plan',
      resourceId: plan._id,
      metadata: { fields: Object.keys(updates) },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Plan updated', plan);
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/admin/subscriptions/plans/:id */
export const deletePlan = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Plan not found');
    }
    // Paying subscribers' access resolves through the plan document
    // (subscriptionAccess.js skips entitlements whose plan is gone), so a
    // plan with live entitlements is retired with isActive: false instead —
    // that hides it from sale but keeps existing buyers' features.
    const activeBuyers = await Entitlement.countDocuments({
      plan: req.params.id,
      status: 'active',
      $or: [{ expiresAt: null }, { expiresAt: { $gt: new Date() } }],
    });
    if (activeBuyers > 0) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        `${activeBuyers} active subscription(s) use this plan. Deactivate it instead of deleting it.`,
      );
    }

    const plan = await SubscriptionPlan.findByIdAndDelete(req.params.id);
    if (!plan) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Plan not found');

    logger.info(`Admin ${req.user?._id} deleted subscription plan ${plan.slug}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.SUBSCRIPTION_PLAN_DELETED,
      resourceType: 'subscription_plan',
      resourceId: req.params.id,
      metadata: { slug: plan.slug },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Plan deleted', { success: true });
  } catch (error) {
    next(error);
  }
};

/* ------------------------------- Coupons -------------------------------- */

const COUPON_FIELDS = [
  'code',
  'description',
  'discountType',
  'discountValue',
  'isActive',
  'expiresAt',
  'maxRedemptions',
  'perUserLimit',
];

/** GET /api/admin/subscriptions/coupons — full catalog incl. inactive. */
export const adminListCoupons = async (req, res, next) => {
  try {
    // ?search= matches the code; ?page=&limit= (default 20, max 100) opts
    // into paging with `pagination` on the envelope. Without page/limit, the
    // full list as before.
    const filter = {};
    if (req.query.search) {
      filter.code = { $regex: escapeRegex(String(req.query.search).trim()), $options: 'i' };
    }
    const query = Coupon.find(filter).sort({ createdAt: -1, _id: -1 });
    if (!isPaginatedRequest(req.query)) {
      return sendResponse(res, HTTP_STATUS.OK, 'Coupons fetched', await query);
    }
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const [coupons, total] = await Promise.all([
      query.skip(skip).limit(limit),
      Coupon.countDocuments(filter),
    ]);
    return sendPaginatedList(
      res,
      'Coupons fetched',
      coupons,
      buildPagination({ page, limit, total }),
    );
  } catch (error) {
    next(error);
  }
};

/** POST /api/admin/subscriptions/coupons */
export const createCoupon = async (req, res, next) => {
  try {
    const payload = pickDefined(req.body, COUPON_FIELDS);
    if (!payload.code || !String(payload.code).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A coupon code is required');
    }
    if (!['percentage', 'flat'].includes(payload.discountType)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, "discountType must be 'percentage' or 'flat'");
    }
    if (payload.discountValue === undefined || payload.discountValue <= 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A discount value greater than 0 is required');
    }
    payload.code = String(payload.code).trim().toUpperCase();

    const existing = await Coupon.findOne({ code: payload.code });
    if (existing) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        `A coupon with code "${payload.code}" already exists`,
      );
    }

    const coupon = await Coupon.create(payload);
    logger.info(`Admin ${req.user?._id} created coupon ${coupon.code}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COUPON_CREATED,
      resourceType: 'coupon',
      resourceId: coupon._id,
      metadata: {
        code: coupon.code,
        discountType: coupon.discountType,
        discountValue: coupon.discountValue,
      },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Coupon created', coupon);
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/admin/subscriptions/coupons/:id */
export const updateCoupon = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Coupon not found');
    }
    const coupon = await Coupon.findById(req.params.id);
    if (!coupon) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Coupon not found');

    const updates = pickDefined(req.body, COUPON_FIELDS);
    if (updates.code !== undefined) {
      updates.code = String(updates.code).trim().toUpperCase();
      const clash = await Coupon.findOne({ code: updates.code, _id: { $ne: coupon._id } });
      if (clash) {
        return sendError(
          res,
          HTTP_STATUS.CONFLICT,
          `A coupon with code "${updates.code}" already exists`,
        );
      }
    }
    if (
      updates.discountType !== undefined &&
      !['percentage', 'flat'].includes(updates.discountType)
    ) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, "discountType must be 'percentage' or 'flat'");
    }
    if (updates.discountValue !== undefined && updates.discountValue <= 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A discount value greater than 0 is required');
    }

    Object.assign(coupon, updates);
    await coupon.save();

    logger.info(`Admin ${req.user?._id} updated coupon ${coupon.code}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COUPON_UPDATED,
      resourceType: 'coupon',
      resourceId: coupon._id,
      metadata: { fields: Object.keys(updates) },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Coupon updated', coupon);
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/admin/subscriptions/coupons/:id */
export const deleteCoupon = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Coupon not found');
    }
    const coupon = await Coupon.findByIdAndDelete(req.params.id);
    if (!coupon) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Coupon not found');

    // Past Entitlements keep their denormalized couponCode/originalAmount
    // for reporting even after the Coupon doc itself is gone.
    logger.info(`Admin ${req.user?._id} deleted coupon ${coupon.code}`);
    await recordAudit({
      req,
      action: AUDIT_ACTIONS.COUPON_DELETED,
      resourceType: 'coupon',
      resourceId: req.params.id,
      metadata: { code: coupon.code },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Coupon deleted', { success: true });
  } catch (error) {
    next(error);
  }
};

/* ------------------------------- Overview ------------------------------- */

/** GET /api/admin/subscriptions/overview — subscriber counts, revenue,
 * recent transactions, for the admin dashboard. Query: ?page=&limit= for the
 * recent-transactions table. */
export const getOverview = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const now = new Date();

    const [activeCount, revenueAgg, revenueByPlan, revenueByFeature, total, recent] =
      await Promise.all([
        Entitlement.countDocuments({
          status: 'active',
          $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }],
        }),
        Entitlement.aggregate([
          { $match: { status: { $in: ['active', 'expired'] } } },
          { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
        ]),
        Entitlement.aggregate([
          { $match: { status: { $in: ['active', 'expired'] }, source: 'plan' } },
          { $group: { _id: '$plan', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          {
            $lookup: {
              from: 'subscriptionplans',
              localField: '_id',
              foreignField: '_id',
              as: 'plan',
            },
          },
          { $unwind: { path: '$plan', preserveNullAndEmptyArrays: true } },
          { $project: { name: '$plan.name', total: 1, count: 1 } },
          { $sort: { total: -1 } },
        ]),
        Entitlement.aggregate([
          { $match: { status: { $in: ['active', 'expired'] }, source: 'feature' } },
          { $group: { _id: '$featureKey', total: { $sum: '$amount' }, count: { $sum: 1 } } },
          { $sort: { total: -1 } },
        ]),
        Entitlement.countDocuments({ status: { $in: ['active', 'expired', 'failed'] } }),
        Entitlement.find({ status: { $in: ['active', 'expired', 'failed'] } })
          .populate('user', 'firstName lastName email')
          .populate('plan', 'name')
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit),
      ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Overview fetched', {
      activeSubscribers: activeCount,
      totalRevenue: revenueAgg[0]?.total || 0,
      totalPaidTransactions: revenueAgg[0]?.count || 0,
      revenueByPlan,
      revenueByFeature,
      recentTransactions: recent,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};
