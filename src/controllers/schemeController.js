import mongoose from 'mongoose';
import GovernmentBenefit from '../models/GovernmentBenefit.js';
import SchemeApplication from '../models/SchemeApplication.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
  normalizeStringArray,
  pickDefined,
} from '../utils/apiHelpers.js';
import {
  SCHEME_CATEGORIES,
  SCHEME_CATEGORY_META,
  GOVERNMENT_LEVELS,
  APPLICATION_STATUSES,
} from '../constants/schemeCategories.js';
import { evaluateEligibility } from '../utils/schemeEligibility.js';

/**
 * Build the Mongo filter shared by list + recommended from the query params.
 * All filters are optional and composable (search, category, state, level).
 */
const buildSchemeFilter = (query) => {
  const filter = { isActive: true };

  if (query.governmentLevel && GOVERNMENT_LEVELS.includes(query.governmentLevel)) {
    filter.governmentLevel = query.governmentLevel;
  }

  // State filter: 'central' is state-independent, so a state filter should
  // surface that state's benefits AND all central ones.
  if (query.state) {
    filter.$or = [{ state: query.state }, { governmentLevel: 'central' }];
  }

  const categories = normalizeStringArray(query.category).filter((c) =>
    SCHEME_CATEGORIES.includes(c),
  );
  if (categories.length > 0) {
    filter.categories = { $in: categories };
  }

  if (query.search) {
    const regex = new RegExp(escapeRegex(String(query.search).trim()), 'i');
    const searchOr = [{ name: regex }, { shortName: regex }, { description: regex }];
    // Merge with any state $or without clobbering it.
    if (filter.$or) {
      filter.$and = [{ $or: filter.$or }, { $or: searchOr }];
      delete filter.$or;
    } else {
      filter.$or = searchOr;
    }
  }

  return filter;
};

/** GET /api/schemes — paginated, searchable, filterable list */
export const getSchemes = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 50 });
    const filter = buildSchemeFilter(req.query);

    const [schemes, total] = await Promise.all([
      GovernmentBenefit.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limit),
      GovernmentBenefit.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Schemes fetched', {
      schemes,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** GET /api/schemes/categories — category metadata for filter chips */
export const getCategories = async (_req, res, next) => {
  try {
    const categories = SCHEME_CATEGORIES.map((key) => ({
      key,
      label: SCHEME_CATEGORY_META[key]?.label || key,
      icon: SCHEME_CATEGORY_META[key]?.icon || 'ellipse-outline',
    }));
    return sendResponse(res, HTTP_STATUS.OK, 'Categories fetched', { categories });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/schemes/recommended — personalized list using the user's own Nura
 * profile (gender, age, state). Never disqualifies on missing data; ranks
 * benefits whose criteria the profile clearly meets higher.
 */
export const getRecommendedSchemes = async (req, res, next) => {
  try {
    const profile = req.user || {};
    const filter = { isActive: true };
    // Surface central benefits + the user's own state. When we don't know the
    // user's state, we only recommend central schemes rather than showing
    // another state's benefits (e.g. Rajasthan) to everyone.
    if (profile.state) {
      filter.$or = [{ governmentLevel: 'central' }, { state: profile.state }];
    } else {
      filter.governmentLevel = 'central';
    }

    const schemes = await GovernmentBenefit.find(filter).sort({ order: 1 });

    const scored = schemes
      .map((scheme) => {
        const evaluation = evaluateEligibility(scheme, profile);
        // Drop clear mismatches from recommendations.
        if (evaluation.status === 'not_eligible') return null;
        const passes = evaluation.criteria.filter((c) => c.result === 'pass').length;
        return { scheme, passes };
      })
      .filter(Boolean)
      .sort((a, b) => b.passes - a.passes || a.scheme.order - b.scheme.order)
      .slice(0, 10)
      .map((entry) => entry.scheme);

    return sendResponse(res, HTTP_STATUS.OK, 'Recommended schemes fetched', { schemes: scored });
  } catch (error) {
    next(error);
  }
};

/** Resolve a scheme by 24-char id or slug. */
const findSchemeByIdentifier = (identifier) =>
  isValidObjectId(identifier)
    ? GovernmentBenefit.findById(identifier)
    : GovernmentBenefit.findOne({ slug: identifier });

/** GET /api/schemes/:id — single scheme by id or slug */
export const getSchemeById = async (req, res, next) => {
  try {
    const scheme = await findSchemeByIdentifier(req.params.id);
    if (!scheme || !scheme.isActive) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Scheme not found');
    }
    return sendResponse(res, HTTP_STATUS.OK, 'Scheme fetched', { scheme });
  } catch (error) {
    next(error);
  }
};

/* ──────────────────────────────────────────────────────────
   Admin scheme management (Content Studio web portal)
   All routes below are gated by authorize('admin').
────────────────────────────────────────────────────────── */

/** Turn a scheme name into a URL-safe slug. */
const slugify = (value = '') =>
  String(value)
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Ensure a slug is unique, appending -2, -3… when a collision exists. */
const uniqueSlug = async (base, excludeId = null) => {
  const root = slugify(base) || `scheme-${Date.now()}`;
  let candidate = root;
  let n = 1;

  while (true) {
    const query = { slug: candidate };
    if (excludeId) query._id = { $ne: excludeId };

    const clash = await GovernmentBenefit.findOne(query).select('_id').lean();
    if (!clash) return candidate;
    n += 1;
    candidate = `${root}-${n}`;
  }
};

// Fields an admin may write via create/update.
const WRITABLE_SCHEME_FIELDS = [
  'name',
  'shortName',
  'type',
  'governmentLevel',
  'state',
  'categories',
  'description',
  'benefits',
  'eligibility',
  'documents',
  'actionType',
  'applicationMethod',
  'applicationSteps',
  'whereToGet',
  'officialUrl',
  'source',
  'helpline',
  'order',
  'lastVerifiedAt',
  'isActive',
];

/**
 * GET /api/schemes/admin/all — full catalogue for the admin portal, including
 * inactive (hidden) schemes, searchable + paginated.
 */
export const adminListSchemes = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });
    const filter = {};

    if (req.query.governmentLevel && GOVERNMENT_LEVELS.includes(req.query.governmentLevel)) {
      filter.governmentLevel = req.query.governmentLevel;
    }
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
      filter.$or = [{ name: rx }, { shortName: rx }, { description: rx }];
    }

    const [schemes, total] = await Promise.all([
      GovernmentBenefit.find(filter).sort({ order: 1, createdAt: -1 }).skip(skip).limit(limit),
      GovernmentBenefit.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Schemes fetched', {
      schemes,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/schemes — create a scheme (admin). */
export const createScheme = async (req, res, next) => {
  try {
    const payload = pickDefined(req.body, WRITABLE_SCHEME_FIELDS);

    if (!payload.name || !String(payload.name).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Scheme name is required');
    }
    if (!payload.description || !String(payload.description).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Description is required');
    }
    if (!payload.governmentLevel || !GOVERNMENT_LEVELS.includes(payload.governmentLevel)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid government level is required');
    }

    // Central schemes are state-independent — never store a state on them.
    if (payload.governmentLevel === 'central') payload.state = null;

    payload.slug = await uniqueSlug(req.body.slug || payload.name);

    const scheme = await GovernmentBenefit.create(payload);
    logger.info(`Admin ${req.user?._id} created scheme ${scheme._id} (${scheme.slug})`);
    return sendResponse(res, HTTP_STATUS.CREATED, 'Scheme created', { scheme });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/schemes/:id — update a scheme (admin). */
export const updateScheme = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Scheme not found');
    }
    const scheme = await GovernmentBenefit.findById(req.params.id);
    if (!scheme) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Scheme not found');
    }

    const updates = pickDefined(req.body, WRITABLE_SCHEME_FIELDS);

    if (updates.name !== undefined && !String(updates.name).trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Scheme name cannot be empty');
    }
    if (
      updates.governmentLevel !== undefined &&
      !GOVERNMENT_LEVELS.includes(updates.governmentLevel)
    ) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid government level is required');
    }

    // Keep the slug in sync only when explicitly provided.
    if (req.body.slug) {
      updates.slug = await uniqueSlug(req.body.slug, scheme._id);
    }

    // Enforce the central/state invariant on level changes.
    const nextLevel = updates.governmentLevel || scheme.governmentLevel;
    if (nextLevel === 'central') updates.state = null;

    Object.assign(scheme, updates);
    await scheme.save();
    logger.info(`Admin ${req.user?._id} updated scheme ${scheme._id}`);
    return sendResponse(res, HTTP_STATUS.OK, 'Scheme updated', { scheme });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/schemes/:id — permanently delete a scheme (admin). */
export const deleteScheme = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Scheme not found');
    }
    const scheme = await GovernmentBenefit.findByIdAndDelete(req.params.id);
    if (!scheme) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Scheme not found');
    }
    logger.info(`Admin ${req.user?._id} deleted scheme ${req.params.id}`);
    return sendResponse(res, HTTP_STATUS.OK, 'Scheme deleted', { success: true });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/schemes/:id/eligibility — evaluate eligibility from the user's Nura
 * profile, optionally overridden by interactive checker answers passed as query
 * params (age, gender, state, isPregnant, hasChildren).
 */
export const checkEligibility = async (req, res, next) => {
  try {
    const scheme = await findSchemeByIdentifier(req.params.id);
    if (!scheme || !scheme.isActive) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Scheme not found');
    }

    const answers = {};
    if (req.query.gender) answers.gender = req.query.gender;
    if (req.query.state) answers.state = req.query.state;
    if (req.query.age !== undefined) answers.age = Number(req.query.age);
    if (req.query.isPregnant !== undefined) {
      answers.isPregnant = req.query.isPregnant === 'true' || req.query.isPregnant === true;
    }
    if (req.query.hasChildren !== undefined) {
      answers.hasChildren = req.query.hasChildren === 'true' || req.query.hasChildren === true;
    }

    const result = evaluateEligibility(scheme, req.user || {}, answers);
    return sendResponse(res, HTTP_STATUS.OK, 'Eligibility evaluated', {
      schemeId: scheme._id,
      actionType: scheme.actionType,
      ...result,
    });
  } catch (error) {
    next(error);
  }
};

/** POST /api/scheme-applications — create a self-service application record */
export const createApplication = async (req, res, next) => {
  try {
    const { schemeId, formData, documents } = req.body;

    if (!schemeId || !isValidObjectId(schemeId)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid schemeId is required');
    }

    const scheme = await GovernmentBenefit.findById(schemeId);
    if (!scheme || !scheme.isActive) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Scheme not found');
    }

    // A SchemeApplication is a personal self-service tracker — any active
    // scheme can be saved so the user can manage/follow up on it, regardless of
    // whether its primary CTA is APPLY, FIND_FACILITY, LEARN_MORE, etc. The
    // action type still drives the UI's primary button; it does not gate this.
    // Guard against duplicate tracking of the same scheme.
    const existing = await SchemeApplication.findOne({ userId: req.userId, schemeId });
    if (existing) {
      return sendResponse(res, HTTP_STATUS.OK, 'Already in your applications', {
        application: existing,
        alreadyExists: true,
      });
    }

    const application = await SchemeApplication.create({
      userId: req.userId,
      schemeId,
      schemeName: scheme.name,
      formData: formData && typeof formData === 'object' ? formData : {},
      documents: Array.isArray(documents) ? documents : [],
      // APPLY schemes start "submitted"; others are saved as a draft to follow up.
      status: scheme.actionType === 'APPLY' ? 'submitted' : 'draft',
    });

    logger.info('scheme_application_created', {
      action: 'scheme_application_created',
      userId: req.userId,
      schemeId,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Application saved', { application });
  } catch (error) {
    logger.error('scheme_application_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** GET /api/scheme-applications — the user's applications, newest first (paginated) */
export const getApplications = async (req, res, next) => {
  try {
    const filter = { userId: req.userId };
    if (req.query.status && APPLICATION_STATUSES.includes(req.query.status)) {
      filter.status = req.query.status;
    }

    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 50 });

    const [applications, total] = await Promise.all([
      SchemeApplication.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('schemeId', 'name shortName slug actionType governmentLevel state officialUrl'),
      SchemeApplication.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Applications fetched', {
      applications,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

// A user may only withdraw their own application — approval/decline/review is
// an admin action (done from the admin portal). Users cannot self-approve.
const USER_SETTABLE_STATUSES = ['withdrawn'];

/** PATCH /api/scheme-applications/:id — update status / notes / form data */
export const updateApplication = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid application id');
    }

    const { status, notes, formData, documents } = req.body;
    const updates = {};

    if (status !== undefined) {
      if (!USER_SETTABLE_STATUSES.includes(status)) {
        return sendError(
          res,
          HTTP_STATUS.BAD_REQUEST,
          `status must be one of: ${USER_SETTABLE_STATUSES.join(', ')}`,
        );
      }
      updates.status = status;
    }
    if (notes !== undefined) updates.notes = notes;
    if (formData && typeof formData === 'object') updates.formData = formData;
    if (Array.isArray(documents)) updates.documents = documents;

    if (Object.keys(updates).length === 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'No valid fields to update');
    }

    const application = await SchemeApplication.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      updates,
      { new: true, runValidators: true },
    ).populate('schemeId', 'name shortName slug actionType governmentLevel state officialUrl');

    if (!application) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Application not found');
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Application updated', { application });
  } catch (error) {
    next(error);
  }
};

/* ─────────────── ADMIN ─────────────── */

// Statuses an admin can set when reviewing an application.
const ADMIN_REVIEW_STATUSES = ['in_review', 'approved', 'rejected'];

/**
 * GET /api/scheme-applications/admin/all — every user's applications, for the
 * admin review queue. Filterable by status/schemeId + free-text search on the
 * scheme name, paginated, newest first.
 */
/**
 * GET /api/scheme-applications/admin/all — the admin review queue.
 *
 * Built as an aggregation so admins can find a specific person among thousands
 * of records: filter by status, scheme, government level, and the applicant's
 * state ("from some place"), full-text search across the applicant's name /
 * email / phone and the scheme name, restrict by a submission date range, and
 * choose the sort order.
 */
export const adminListApplications = async (req, res, next) => {
  try {
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });

    // Filters that apply before the user/scheme joins (indexed fields).
    const preMatch = {};
    if (req.query.status && APPLICATION_STATUSES.includes(req.query.status)) {
      preMatch.status = req.query.status;
    }
    if (req.query.schemeId && isValidObjectId(req.query.schemeId)) {
      preMatch.schemeId = new mongoose.Types.ObjectId(req.query.schemeId);
    }

    const createdAt = {};
    if (req.query.dateFrom) {
      const d = new Date(req.query.dateFrom);
      if (!Number.isNaN(d.getTime())) createdAt.$gte = d;
    }
    if (req.query.dateTo) {
      const d = new Date(req.query.dateTo);
      if (!Number.isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        createdAt.$lte = d;
      }
    }
    if (Object.keys(createdAt).length) preMatch.createdAt = createdAt;

    // Filters that need the joined applicant / scheme documents.
    const postMatch = {};
    if (req.query.state) {
      postMatch['applicant.state'] = new RegExp(
        `^${escapeRegex(String(req.query.state).trim())}$`,
        'i',
      );
    }
    if (req.query.governmentLevel && GOVERNMENT_LEVELS.includes(req.query.governmentLevel)) {
      postMatch['scheme.governmentLevel'] = req.query.governmentLevel;
    }
    if (req.query.search) {
      const rx = new RegExp(escapeRegex(String(req.query.search).trim()), 'i');
      postMatch.$or = [
        { 'applicant.firstName': rx },
        { 'applicant.lastName': rx },
        { 'applicant.fullName': rx },
        { 'applicant.email': rx },
        { 'applicant.phone': rx },
        { schemeName: rx },
        { 'scheme.name': rx },
      ];
    }

    const SORTS = {
      newest: { createdAt: -1 },
      oldest: { createdAt: 1 },
      updated: { updatedAt: -1 },
    };
    const sort = SORTS[req.query.sort] || SORTS.newest;

    const pipeline = [
      { $match: preMatch },
      {
        $lookup: {
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'applicant',
        },
      },
      { $unwind: { path: '$applicant', preserveNullAndEmptyArrays: true } },
      {
        $lookup: {
          from: 'governmentbenefits',
          localField: 'schemeId',
          foreignField: '_id',
          as: 'scheme',
        },
      },
      { $unwind: { path: '$scheme', preserveNullAndEmptyArrays: true } },
      {
        $addFields: {
          'applicant.fullName': {
            $trim: {
              input: {
                $concat: [
                  { $ifNull: ['$applicant.firstName', ''] },
                  ' ',
                  { $ifNull: ['$applicant.lastName', ''] },
                ],
              },
            },
          },
        },
      },
      { $match: postMatch },
      {
        $facet: {
          data: [
            { $sort: sort },
            { $skip: skip },
            { $limit: limit },
            {
              $project: {
                status: 1,
                notes: 1,
                reviewNote: 1,
                reviewedAt: 1,
                schemeName: 1,
                formData: 1,
                documents: 1,
                createdAt: 1,
                updatedAt: 1,
                userId: {
                  _id: '$applicant._id',
                  firstName: '$applicant.firstName',
                  lastName: '$applicant.lastName',
                  email: '$applicant.email',
                  phone: '$applicant.phone',
                  state: '$applicant.state',
                },
                schemeId: {
                  _id: '$scheme._id',
                  name: '$scheme.name',
                  shortName: '$scheme.shortName',
                  slug: '$scheme.slug',
                  actionType: '$scheme.actionType',
                  governmentLevel: '$scheme.governmentLevel',
                  state: '$scheme.state',
                },
              },
            },
          ],
          total: [{ $count: 'count' }],
        },
      },
    ];

    const [result] = await SchemeApplication.aggregate(pipeline);
    const applications = result?.data ?? [];
    const total = result?.total?.[0]?.count ?? 0;

    return sendResponse(res, HTTP_STATUS.OK, 'Applications fetched', {
      applications,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/scheme-applications/admin/filters — data the admin queue's filter
 * controls need: per-status counts (for the tab badges), the distinct applicant
 * states present, and the schemes that actually have applications.
 */
export const adminApplicationFilters = async (_req, res, next) => {
  try {
    const [statusAgg, stateAgg, schemeAgg] = await Promise.all([
      SchemeApplication.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      SchemeApplication.aggregate([
        { $lookup: { from: 'users', localField: 'userId', foreignField: '_id', as: 'u' } },
        { $unwind: '$u' },
        { $group: { _id: '$u.state' } },
        { $match: { _id: { $nin: [null, ''] } } },
        { $sort: { _id: 1 } },
      ]),
      SchemeApplication.aggregate([
        { $group: { _id: '$schemeId' } },
        {
          $lookup: {
            from: 'governmentbenefits',
            localField: '_id',
            foreignField: '_id',
            as: 's',
          },
        },
        { $unwind: '$s' },
        { $project: { _id: '$s._id', name: '$s.name', shortName: '$s.shortName' } },
        { $sort: { name: 1 } },
      ]),
    ]);

    const statusCounts = {};
    let total = 0;
    statusAgg.forEach((s) => {
      statusCounts[s._id] = s.count;
      total += s.count;
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Filters fetched', {
      statusCounts,
      total,
      states: stateAgg.map((s) => s._id),
      schemes: schemeAgg,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * PATCH /api/scheme-applications/admin/:id — admin approves/declines/reviews an
 * application, recording who reviewed it and an optional note.
 */
export const adminReviewApplication = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid application id');
    }

    const { status, reviewNote } = req.body;
    if (!status || !ADMIN_REVIEW_STATUSES.includes(status)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        `status must be one of: ${ADMIN_REVIEW_STATUSES.join(', ')}`,
      );
    }

    const updates = {
      status,
      reviewedBy: req.userId,
      reviewedAt: new Date(),
    };
    if (reviewNote !== undefined) updates.reviewNote = reviewNote;

    const application = await SchemeApplication.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    })
      .populate('userId', 'firstName lastName email')
      .populate('schemeId', 'name shortName slug actionType governmentLevel state');

    if (!application) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Application not found');
    }

    logger.info('scheme_application_reviewed', {
      action: 'scheme_application_reviewed',
      adminId: req.userId,
      applicationId: req.params.id,
      status,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Application reviewed', { application });
  } catch (error) {
    next(error);
  }
};

/** GET /api/scheme-applications/:id — a single application owned by the user */
export const getApplicationById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid application id');
    }

    const application = await SchemeApplication.findOne({
      _id: req.params.id,
      userId: req.userId,
    }).populate('schemeId', 'name shortName slug actionType governmentLevel state officialUrl');

    if (!application) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Application not found');
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Application fetched', { application });
  } catch (error) {
    next(error);
  }
};
