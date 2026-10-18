import slugify from 'slugify';
import { readStats } from '../utils/blogReadStats.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import Blog from '../models/Blog.js';
import { blogCategoryEnum, blogStatusEnum } from '../enums/enums.js';
import HealthIssue from '../models/HealthIssue.js';
import QuestionAnswer from '../models/QuestionAnswer.js';
import Reel from '../models/Reel.js';
import { normalizeReelTags } from '../utils/reelSocial.js';
import WellbeingResource from '../models/WellbeingResource.js';
import {
  CONTENT_STATES,
  IN_REVIEW_STATUSES,
  REVIEW_ACTIONS,
  REVIEW_ADMIN_SELECT,
  canPerformReviewAction,
  changedReviewedFields,
  clearedReviewStamp,
  contentState,
  describeReview,
  normalizeReviewAction,
  normalizeReviewNote,
  planReviewTransition,
  reviewStamp,
  reviewerDisplayName,
  reviewerForRequest,
  shouldClearReviewStamp,
  stripReviewFields,
} from '../utils/medicalReview.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { sendError, sendResponse } from '../utils/sendResponse.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  HEX_COLOR_REGEX,
  isValidObjectId,
  normalizeBoolean,
  normalizeStringArray,
  pickDefined,
} from '../utils/apiHelpers.js';

// Both the state names ('published') and the action verbs a status menu
// sends ('publish') are accepted. Only the state names used to be, so a
// portal sending `{ status: 'publish' }`/`'unpublish'`/`'archive'` got a 400
// "Invalid status".
const ACTIVE_STATUSES = new Set([
  'active',
  'activate',
  'published',
  'publish',
  'live',
  'enabled',
  'enable',
  'visible',
  'show',
]);
const INACTIVE_STATUSES = new Set([
  'inactive',
  'deactivate',
  'draft',
  'unpublished',
  'unpublish',
  'archived',
  'archive',
  'disabled',
  'disable',
  'hidden',
  'hide',
]);
const ARCHIVED_STATUSES = new Set(['archived', 'archive']);
const BLOG_CATEGORIES = Object.values(blogCategoryEnum);
const QUESTION_CATEGORY_ALIASES = {
  body: 'female_body',
  cycle: 'tracking',
  emergency: 'health',
  female: 'female_body',
  'female body': 'female_body',
  fertility: 'fertility',
  general: 'general',
  health: 'health',
  hygiene: 'hygiene',
  intimacy: 'sexual_health',
  mental: 'mental_health',
  'mental health': 'mental_health',
  ovulation: 'fertility',
  period: 'periods',
  periods: 'periods',
  pms: 'symptoms',
  sex: 'sexual_health',
  'sexual health': 'sexual_health',
  symptoms: 'symptoms',
  tracking: 'tracking',
  wellness: 'health',
};

const TYPE_ALIASES = {
  blog: 'blog',
  blogs: 'blog',
  article: 'blog',
  articles: 'blog',
  video: 'video',
  videos: 'video',
  reel: 'video',
  reels: 'video',
  qa: 'question-answer',
  qas: 'question-answer',
  question: 'question-answer',
  questions: 'question-answer',
  'question-answer': 'question-answer',
  'question-answers': 'question-answer',
  question_answer: 'question-answer',
  question_answers: 'question-answer',
  health: 'health-issue',
  'health-issue': 'health-issue',
  'health-issues': 'health-issue',
  health_issue: 'health-issue',
  health_issues: 'health-issue',
  wellbeing: 'wellbeing',
  wellbeing_resource: 'wellbeing',
  wellbeing_resources: 'wellbeing',
  'wellbeing-resource': 'wellbeing',
  'wellbeing-resources': 'wellbeing',
};

const trimOrUndefined = (value) => {
  if (value === undefined || value === null) return undefined;
  const trimmed = String(value).trim();
  return trimmed || undefined;
};

const normalizeContentType = (value) =>
  TYPE_ALIASES[
    String(value || '')
      .trim()
      .toLowerCase()
  ] || null;
const normalizeQuestionCategory = (value) => {
  const normalized = String(value || 'general')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  return QUESTION_CATEGORY_ALIASES[normalized] || normalized.replace(/\s+/g, '_');
};

const isInReviewStatus = (status) =>
  IN_REVIEW_STATUSES.has(
    String(status ?? '')
      .trim()
      .toLowerCase(),
  );

const resolveStatusFilter = (status) => {
  if (!status || String(status).toLowerCase() === 'all') return { valid: true, value: null };

  const normalized = String(status).trim().toLowerCase();
  if (ACTIVE_STATUSES.has(normalized)) return { valid: true, value: true };
  if (INACTIVE_STATUSES.has(normalized)) return { valid: true, value: false };
  // Awaiting medical review: hidden from the app like a draft.
  if (isInReviewStatus(normalized)) return { valid: true, value: false };

  return { valid: false, value: null };
};

// Boolean visibility flags, in priority order after `status`. `published`,
// `active` and `visible` used to be ignored, so PATCH .../publish with
// `{ published: false }` fell through to the "publish" default and made the
// item LIVE instead of hiding it.
const VISIBILITY_FLAGS = ['isPublished', 'isActive', 'publish', 'published', 'active', 'visible'];

export const resolveVisibilityInput = (body = {}, fallback) => {
  if (body.status !== undefined) {
    const resolved = resolveStatusFilter(body.status);
    if (!resolved.valid || resolved.value === null) return { provided: true, invalid: true };
    const archived = ARCHIVED_STATUSES.has(String(body.status).trim().toLowerCase());
    // `in_review` reads as hidden; entering or leaving review only happens
    // through POST /:type/:id/review, so callers treat it as "stay hidden".
    const inReview = isInReviewStatus(body.status);
    return {
      provided: true,
      value: resolved.value,
      ...(archived ? { archived: true } : {}),
      ...(inReview ? { inReview: true } : {}),
    };
  }
  const flag = VISIBILITY_FLAGS.find((field) => body[field] !== undefined);
  if (flag) return { provided: true, value: normalizeBoolean(body[flag]) };
  if (fallback !== undefined) return { provided: true, value: fallback };
  return { provided: false };
};

/**
 * Blog fields for a visibility change. `status` is set explicitly so an
 * archive stays an archive (the Blog hooks would otherwise call any hidden
 * post a draft). `publishedAt` is left to the Blog model, which fills it the
 * first time a post goes live and keeps it on a re-publish.
 */
const blogVisibilityFields = (visibility) => ({
  isPublished: visibility.value,
  status: visibility.value
    ? blogStatusEnum.PUBLISHED
    : visibility.archived
      ? blogStatusEnum.ARCHIVED
      : blogStatusEnum.DRAFT,
});

/** A blog category from a request: the enum value (any case), undefined when
 * absent, or null when it isn't a known category. The workspace used to
 * default new blogs to 'General', which the lowercase enum rejected, so every
 * blog created without a category failed. */
export const normalizeBlogCategory = (value) => {
  const trimmed = trimOrUndefined(value);
  if (trimmed === undefined) return undefined;
  const lower = trimmed.toLowerCase();
  return BLOG_CATEGORIES.includes(lower) ? lower : null;
};
const INVALID_BLOG_CATEGORY = `category must be one of: ${BLOG_CATEGORIES.join(', ')}`;

const createUniqueSlug = async (Model, source, existingId = null) => {
  const baseSlug =
    slugify(source, { lower: true, strict: true }).slice(0, 90) || `content-${Date.now()}`;
  let slug = baseSlug;
  let suffix = 1;

  while (
    await Model.exists({
      slug,
      ...(existingId ? { _id: { $ne: existingId } } : {}),
    })
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
};

const addSearchFilter = (filter, search, fields) => {
  if (!search) return;
  filter.$or = fields.map((field) => ({
    [field]: { $regex: escapeRegex(search), $options: 'i' },
  }));
};

const addVisibilityFilter = (filter, status, statusField) => {
  if (isInReviewStatus(status)) {
    filter[statusField] = { $ne: true };
    filter.inReview = true;
    return true;
  }
  const resolved = resolveStatusFilter(status);
  if (!resolved.valid) return false;
  if (resolved.value !== null) filter[statusField] = resolved.value;
  // Items awaiting review have their own tab, not the draft/inactive one.
  if (resolved.value === false) filter.inReview = { $ne: true };
  return true;
};

const toPlain = (document) => (document?.toObject ? document.toObject() : document);

const serializeBlog = (document, options = {}) => {
  const object = toPlain(document);
  const { content, ...rest } = object;

  return {
    ...rest,
    ...(options.includeBody ? { content } : {}),
    id: String(object._id),
    type: 'blog',
    status: object.isPublished
      ? 'published'
      : object.inReview
        ? CONTENT_STATES.IN_REVIEW
        : object.status === blogStatusEnum.ARCHIVED
          ? 'archived'
          : 'draft',
    review: describeReview(object),
    imageUrl: object.coverImageUrl,
    metrics: {
      views: object.viewCount || 0,
      likes: object.likeCount || 0,
      ...readStats(object),
    },
  };
};

const serializeVideo = (document) => {
  const object = toPlain(document);

  return {
    ...object,
    id: String(object._id),
    type: 'video',
    status: object.isActive ? 'active' : object.inReview ? CONTENT_STATES.IN_REVIEW : 'inactive',
    review: describeReview(object),
    videoUrl: object.directMp4Url,
    imageUrl: object.thumbnailUrl,
    summary: object.description || '',
    tags: object.tags || [],
    metrics: {
      views: object.viewCount || 0,
      likes: object.likeCount || 0,
      comments: object.commentCount || 0,
      saves: object.saveCount || 0,
    },
  };
};

const serializeQuestionAnswer = (document) => {
  const object = toPlain(document);

  return {
    ...object,
    id: String(object._id),
    type: 'question-answer',
    title: object.question,
    status: object.isPublished ? 'published' : object.inReview ? CONTENT_STATES.IN_REVIEW : 'draft',
    review: describeReview(object),
    metrics: {
      views: object.viewCount || 0,
      likes: object.likeCount || 0,
    },
  };
};

const serializeHealthIssue = (document) => {
  const object = toPlain(document);

  return {
    ...object,
    id: String(object._id),
    type: 'health-issue',
    status: object.isActive ? 'active' : object.inReview ? CONTENT_STATES.IN_REVIEW : 'inactive',
    review: describeReview(object),
    imageUrl: object.imageUrl,
  };
};

const serializeWellbeing = (document) => {
  const object = toPlain(document);

  return {
    ...object,
    id: String(object._id),
    type: 'wellbeing',
    category: object.type,
    resourceType: object.type,
    status: object.isActive ? 'active' : object.inReview ? CONTENT_STATES.IN_REVIEW : 'inactive',
    review: describeReview(object),
  };
};

const buildBlogFilter = (query) => {
  const filter = {};
  if (!addVisibilityFilter(filter, query.status, 'isPublished')) return null;
  // Blogs alone can be archived: keep archived posts out of "draft" and let
  // the portal list them on their own.
  const statusQuery = String(query.status || '')
    .trim()
    .toLowerCase();
  if (ARCHIVED_STATUSES.has(statusQuery)) filter.status = blogStatusEnum.ARCHIVED;
  else if (statusQuery === 'draft') filter.status = { $ne: blogStatusEnum.ARCHIVED };
  if (query.category) filter.category = query.category;
  if (query.tag || query.tags) filter.tags = { $in: normalizeStringArray(query.tag || query.tags) };
  addSearchFilter(filter, query.search, ['title', 'excerpt', 'content', 'author']);
  return filter;
};

const buildVideoFilter = (query) => {
  const filter = {};
  if (!addVisibilityFilter(filter, query.status, 'isActive')) return null;
  if (query.category && query.category !== 'all') filter.category = query.category;
  addSearchFilter(filter, query.search, ['title', 'creatorName', 'category', 'pollQuestion']);
  return filter;
};

const buildQuestionAnswerFilter = (query) => {
  const filter = {};
  if (!addVisibilityFilter(filter, query.status, 'isPublished')) return null;
  if (query.category) filter.category = query.category;
  if (query.tag || query.tags) filter.tags = { $in: normalizeStringArray(query.tag || query.tags) };
  if (query.featured !== undefined) filter.isFeatured = normalizeBoolean(query.featured);
  addSearchFilter(filter, query.search, ['question', 'answer', 'shortAnswer']);
  return filter;
};

const buildHealthIssueFilter = (query) => {
  const filter = {};
  if (!addVisibilityFilter(filter, query.status, 'isActive')) return null;
  if (query.category) filter.category = query.category;
  addSearchFilter(filter, query.search, ['title', 'summary', 'guide', 'category']);
  return filter;
};

const buildWellbeingFilter = (query) => {
  const filter = {};
  if (!addVisibilityFilter(filter, query.status, 'isActive')) return null;
  if (query.resourceType || query.wellbeingType || query.category) {
    filter.type = query.resourceType || query.wellbeingType || query.category;
  }
  addSearchFilter(filter, query.search, ['title', 'summary']);
  return filter;
};

const CONTENT_CONFIG = {
  blog: {
    Model: Blog,
    statusField: 'isPublished',
    activeName: 'published',
    inactiveName: 'draft',
    defaultActive: false,
    buildFilter: buildBlogFilter,
    serialize: serializeBlog,
    sort: { updatedAt: -1, publishedAt: -1, createdAt: -1 },
  },
  video: {
    Model: Reel,
    statusField: 'isActive',
    activeName: 'active',
    inactiveName: 'inactive',
    defaultActive: true,
    buildFilter: buildVideoFilter,
    serialize: serializeVideo,
    sort: { updatedAt: -1, publishedAt: -1, createdAt: -1 },
  },
  'question-answer': {
    Model: QuestionAnswer,
    statusField: 'isPublished',
    activeName: 'published',
    inactiveName: 'draft',
    defaultActive: false,
    buildFilter: buildQuestionAnswerFilter,
    serialize: serializeQuestionAnswer,
    sort: { updatedAt: -1, createdAt: -1 },
  },
  'health-issue': {
    Model: HealthIssue,
    statusField: 'isActive',
    activeName: 'active',
    inactiveName: 'inactive',
    defaultActive: true,
    buildFilter: buildHealthIssueFilter,
    serialize: serializeHealthIssue,
    sort: { updatedAt: -1, order: 1, createdAt: -1 },
  },
  wellbeing: {
    Model: WellbeingResource,
    statusField: 'isActive',
    activeName: 'active',
    inactiveName: 'inactive',
    defaultActive: true,
    buildFilter: buildWellbeingFilter,
    serialize: serializeWellbeing,
    sort: { updatedAt: -1, order: 1, createdAt: -1 },
  },
};

const CONTENT_TYPES = Object.keys(CONTENT_CONFIG);

const getAdminName = (user) => {
  const name = `${user?.firstName || ''} ${user?.lastName || ''}`.trim();
  return name || 'Period Buddy Team';
};

const normalizePollOptions = (pollOptions) => {
  if (!Array.isArray(pollOptions)) return [];

  return pollOptions
    .map((option, index) => ({
      optionId: trimOrUndefined(option.optionId) || `option_${index + 1}`,
      topic: trimOrUndefined(option.topic),
      votes: Number(option.votes || 0),
    }))
    .filter((option) => option.topic);
};

const validateColor = (color) => !color || HEX_COLOR_REGEX.test(color);

const getIdentifierFilter = (type, id) => {
  if (isValidObjectId(id)) return { _id: id };
  if (type === 'blog' || type === 'question-answer') return { slug: id };
  return null;
};

export const getContentTypes = async (req, res) =>
  sendResponse(res, HTTP_STATUS.OK, 'Content types fetched', {
    types: [
      { type: 'blog', label: 'Blogs', statuses: ['published', 'draft', 'in_review', 'archived'] },
      {
        type: 'video',
        label: 'Videos',
        aliases: ['reel'],
        statuses: ['active', 'inactive', 'in_review'],
      },
      {
        type: 'question-answer',
        label: 'Question Answers',
        aliases: ['qa'],
        statuses: ['published', 'draft', 'in_review'],
      },
      {
        type: 'health-issue',
        label: 'Health Issues',
        statuses: ['active', 'inactive', 'in_review'],
      },
      {
        type: 'wellbeing',
        label: 'Wellbeing Resources',
        statuses: ['active', 'inactive', 'in_review'],
      },
    ],
  });

export const getContentSummary = async (req, res, next) => {
  try {
    const entries = await Promise.all(
      CONTENT_TYPES.map(async (type) => {
        const config = CONTENT_CONFIG[type];
        const [total, active, inReview] = await Promise.all([
          config.Model.countDocuments(),
          config.Model.countDocuments({ [config.statusField]: true }),
          config.Model.countDocuments({ [config.statusField]: { $ne: true }, inReview: true }),
        ]);

        return [
          type,
          {
            total,
            [config.activeName]: active,
            // Hidden items, in review included (kept as before for old clients).
            [config.inactiveName]: total - active,
            inReview,
          },
        ];
      }),
    );

    const byType = Object.fromEntries(entries);
    const total = entries.reduce((sum, [, value]) => sum + value.total, 0);
    const awaitingReview = entries.reduce((sum, [, value]) => sum + value.inReview, 0);

    return sendResponse(res, HTTP_STATUS.OK, 'Content summary fetched', {
      total,
      awaitingReview,
      byType,
    });
  } catch (error) {
    next(error);
  }
};

export const listContent = async (req, res, next) => {
  try {
    const requestedType = req.query.type ? normalizeContentType(req.query.type) : 'all';
    if (!requestedType && String(req.query.type).toLowerCase() !== 'all') {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');
    }

    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });

    if (requestedType && requestedType !== 'all') {
      const config = CONTENT_CONFIG[requestedType];
      const filter = config.buildFilter(req.query);
      if (!filter) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid status');

      const [documents, total] = await Promise.all([
        config.Model.find(filter)
          .select(REVIEW_ADMIN_SELECT)
          .sort(config.sort)
          .skip(skip)
          .limit(limit),
        config.Model.countDocuments(filter),
      ]);

      return sendResponse(res, HTTP_STATUS.OK, 'Content fetched', {
        type: requestedType,
        items: documents.map((document) => config.serialize(document, { includeBody: true })),
        pagination: buildPagination({ page, limit, total }),
      });
    }

    // Content types are unrelated resources (different schemas, different
    // admin tabs) and must never be mixed into one interleaved list — each
    // type is fetched in full and kept in its own bucket, so adding to one
    // type can never push another type out of view.
    const queryResults = await Promise.all(
      CONTENT_TYPES.map(async (type) => {
        const config = CONTENT_CONFIG[type];
        const filter = config.buildFilter(req.query);
        if (!filter) return { invalid: true };

        // Previously unbounded — every blog/reel/QA/health-issue/wellbeing
        // document's full body was returned with no cap when `type=all`
        // (or no `type`), unlike every other list endpoint in this codebase.
        // Reuses the same `limit` the single-type branch above already
        // applies, per content type.
        const documents = await config.Model.find(filter)
          .select(REVIEW_ADMIN_SELECT)
          .sort(config.sort)
          .limit(limit);

        return {
          type,
          items: documents.map((document) => config.serialize(document, { includeBody: true })),
        };
      }),
    );

    if (queryResults.some((result) => result.invalid)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid status');
    }

    const content = Object.fromEntries(queryResults.map((result) => [result.type, result.items]));
    const totalsByType = Object.fromEntries(
      queryResults.map((result) => [result.type, result.items.length]),
    );
    const total = queryResults.reduce((sum, result) => sum + result.items.length, 0);

    return sendResponse(res, HTTP_STATUS.OK, 'Content fetched', {
      type: 'all',
      content,
      total,
      totalsByType,
    });
  } catch (error) {
    next(error);
  }
};

export const getContentById = async (req, res, next) => {
  try {
    const type = normalizeContentType(req.params.type);
    if (!type) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');

    const filter = getIdentifierFilter(type, req.params.id);
    if (!filter) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content id');

    const config = CONTENT_CONFIG[type];
    const document = await config.Model.findOne(filter).select(REVIEW_ADMIN_SELECT);
    if (!document) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Content fetched',
      config.serialize(document, { includeBody: true }),
    );
  } catch (error) {
    next(error);
  }
};

const createBlog = async (body, review = {}) => {
  const title = trimOrUndefined(body.title);
  const content = trimOrUndefined(body.content);
  if (!title || !content) {
    return { error: 'title and content are required' };
  }

  const visibility = resolveVisibilityInput(body, CONTENT_CONFIG.blog.defaultActive);
  if (visibility.invalid) return { error: 'Invalid status' };
  const category = normalizeBlogCategory(body.category);
  if (category === null) return { error: INVALID_BLOG_CATEGORY };

  const slug = await createUniqueSlug(Blog, title);
  const blog = await Blog.create({
    title,
    slug,
    content,
    excerpt: trimOrUndefined(body.excerpt),
    coverImageUrl: trimOrUndefined(body.coverImageUrl || body.imageUrl),
    category: category || blogCategoryEnum.GENERAL,
    tags: normalizeStringArray(body.tags),
    author: trimOrUndefined(body.author) || 'Period Buddy Team',
    // readTimeMinutes is computed from `content` by the Blog model.
    seoTitle: trimOrUndefined(body.seoTitle),
    seoDescription: trimOrUndefined(body.seoDescription),
    keywords: normalizeStringArray(body.keywords),
    ...blogVisibilityFields(visibility),
    publishedAt: visibility.value && body.publishedAt ? new Date(body.publishedAt) : undefined,
    ...review,
  });

  return { document: blog, serialize: serializeBlog };
};

const createVideo = async (body, user, review = {}) => {
  const title = trimOrUndefined(body.title);
  const thumbnailUrl = trimOrUndefined(body.thumbnailUrl || body.imageUrl);
  const directMp4Url = trimOrUndefined(body.directMp4Url || body.videoUrl);
  if (!title || !thumbnailUrl || !directMp4Url) {
    return { error: 'title, thumbnailUrl, and directMp4Url are required' };
  }

  const visibility = resolveVisibilityInput(body, CONTENT_CONFIG.video.defaultActive);
  if (visibility.invalid) return { error: 'Invalid status' };

  const video = await Reel.create({
    title,
    creatorId: trimOrUndefined(body.creatorId) || `admin_${user?._id || 'period_buddy'}`,
    creatorName:
      trimOrUndefined(body.creatorName) || trimOrUndefined(body.author) || getAdminName(user),
    creatorAvatar: trimOrUndefined(body.creatorAvatar),
    duration: trimOrUndefined(body.duration),
    category: trimOrUndefined(body.category) || 'Wellness',
    verified: normalizeBoolean(body.verified, true),
    thumbnailUrl,
    directMp4Url,
    pollQuestion: trimOrUndefined(body.pollQuestion),
    pollOptions: normalizePollOptions(body.pollOptions),
    description: trimOrUndefined(body.description ?? body.summary),
    tags: normalizeReelTags(body.tags),
    isActive: visibility.value,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : new Date(),
    ...review,
  });

  return { document: video, serialize: serializeVideo };
};

const createQuestionAnswer = async (body, review = {}) => {
  const question = trimOrUndefined(body.question || body.title);
  const answer = trimOrUndefined(body.answer || body.content);
  if (!question || !answer) {
    return { error: 'question and answer are required' };
  }

  const visibility = resolveVisibilityInput(body, CONTENT_CONFIG['question-answer'].defaultActive);
  if (visibility.invalid) return { error: 'Invalid status' };

  const slug = await createUniqueSlug(QuestionAnswer, question);
  const qa = await QuestionAnswer.create({
    question,
    answer,
    shortAnswer: trimOrUndefined(body.shortAnswer),
    category: normalizeQuestionCategory(body.category),
    subCategory: trimOrUndefined(body.subCategory),
    bodyPart: normalizeStringArray(body.bodyPart),
    gender: normalizeStringArray(body.gender),
    ageGroups: normalizeStringArray(body.ageGroups),
    tags: normalizeStringArray(body.tags),
    symptoms: normalizeStringArray(body.symptoms),
    relatedProducts: normalizeStringArray(body.relatedProducts),
    keywords: normalizeStringArray(body.keywords),
    difficultyLevel: trimOrUndefined(body.difficultyLevel),
    contentType: trimOrUndefined(body.contentType),
    language: trimOrUndefined(body.language),
    isSensitive: normalizeBoolean(body.isSensitive),
    isFeatured: normalizeBoolean(body.isFeatured),
    sourceLinks: normalizeStringArray(body.sourceLinks),
    seoTitle: trimOrUndefined(body.seoTitle),
    seoDescription: trimOrUndefined(body.seoDescription),
    isPublished: visibility.value,
    slug,
    ...review,
  });

  return { document: qa, serialize: serializeQuestionAnswer };
};

const createHealthIssue = async (body, review = {}) => {
  const title = trimOrUndefined(body.title);
  const category = trimOrUndefined(body.category);
  const summary = trimOrUndefined(body.summary);
  const guide = trimOrUndefined(body.guide || body.content);
  if (!title || !category || !summary || !guide) {
    return { error: 'title, category, summary, and guide are required' };
  }
  if (!validateColor(body.color)) return { error: 'color must be a valid hex color' };

  const visibility = resolveVisibilityInput(body, CONTENT_CONFIG['health-issue'].defaultActive);
  if (visibility.invalid) return { error: 'Invalid status' };

  const issue = await HealthIssue.create({
    title,
    category,
    icon: trimOrUndefined(body.icon),
    color: trimOrUndefined(body.color),
    summary,
    guide,
    imageUrl: trimOrUndefined(body.imageUrl || body.coverImageUrl),
    symptoms: normalizeStringArray(body.symptoms),
    causes: normalizeStringArray(body.causes),
    treatment: trimOrUndefined(body.treatment),
    prevention: trimOrUndefined(body.prevention),
    whenToSeeDoctor: trimOrUndefined(body.whenToSeeDoctor),
    order: body.order,
    isActive: visibility.value,
    ...review,
  });

  return { document: issue, serialize: serializeHealthIssue };
};

const createWellbeing = async (body, review = {}) => {
  const type = trimOrUndefined(body.resourceType || body.type);
  const title = trimOrUndefined(body.title);
  const summary = trimOrUndefined(body.summary || body.excerpt);
  if (!type || !title || !summary) {
    return { error: 'type, title, and summary are required' };
  }
  if (!validateColor(body.color)) return { error: 'color must be a valid hex color' };

  const visibility = resolveVisibilityInput(body, CONTENT_CONFIG.wellbeing.defaultActive);
  if (visibility.invalid) return { error: 'Invalid status' };

  const resource = await WellbeingResource.create({
    type,
    title,
    icon: trimOrUndefined(body.icon),
    color: trimOrUndefined(body.color),
    summary,
    extendedGuide: normalizeStringArray(body.extendedGuide || body.content),
    items: body.items,
    order: body.order,
    isActive: visibility.value,
    estimatedReadTime:
      body.estimatedReadTime !== undefined
        ? Number(body.estimatedReadTime)
        : body.readTimeMinutes !== undefined
          ? Number(body.readTimeMinutes)
          : undefined,
    videoUrl: trimOrUndefined(body.videoUrl || body.directMp4Url),
    audioUrl: trimOrUndefined(body.audioUrl),
    ...review,
  });

  return { document: resource, serialize: serializeWellbeing };
};

export const createContent = async (req, res, next) => {
  try {
    const type = normalizeContentType(req.params.type);
    if (!type) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');

    // The review stamp is server-written only; a reviewer (content.approve)
    // creating something live is its reviewer.
    const body = stripReviewFields(req.body);
    const reviewer = reviewerForRequest(req);
    const live = resolveVisibilityInput(body, CONTENT_CONFIG[type].defaultActive).value === true;
    const review = live && reviewer ? reviewStamp(reviewer) : {};

    const creators = {
      blog: () => createBlog(body, review),
      video: () => createVideo(body, req.user, review),
      'question-answer': () => createQuestionAnswer(body, review),
      'health-issue': () => createHealthIssue(body, review),
      wellbeing: () => createWellbeing(body, review),
    };

    const result = await creators[type]();
    if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.CONTENT_CREATED,
      resourceType: type,
      resourceId: result.document?._id,
    });
    if (review.medicallyReviewed) {
      await recordAudit({
        req,
        action: AUDIT_ACTIONS.CONTENT_REVIEW_APPROVED,
        resourceType: type,
        resourceId: result.document?._id,
        metadata: { via: 'create', reviewerId: String(reviewer._id) },
      });
    }
    return sendResponse(
      res,
      HTTP_STATUS.CREATED,
      'Content created',
      result.serialize(result.document, { includeBody: true }),
    );
  } catch (error) {
    next(error);
  }
};

const buildBlogUpdates = async (body, id) => {
  const updates = pickDefined(body, [
    'title',
    'content',
    'excerpt',
    'coverImageUrl',
    'category',
    'tags',
    'author',
    'seoTitle',
    'seoDescription',
    'keywords',
    'publishedAt',
  ]);
  // readTimeMinutes is not editable: the Blog model computes it from content.

  const current = await Blog.findById(id).select('title category isPublished').lean();
  if (!current) return { updates }; // updateContent answers 404

  if (body.imageUrl !== undefined && updates.coverImageUrl === undefined)
    updates.coverImageUrl = body.imageUrl;
  if (updates.title !== undefined) {
    const title = trimOrUndefined(updates.title);
    if (!title) return { error: 'title cannot be empty' };
    updates.title = title;
    // The edit form sends the title on every save (a status change included).
    // Re-deriving the slug each time renamed URLs of posts whose slug didn't
    // match a fresh slugify of the title (older posts, long titles, `-2`
    // suffixes), breaking links and bookmarks. Now only a real rename of a
    // post that isn't live moves its URL.
    if (title !== current.title && !current.isPublished) {
      updates.slug = await createUniqueSlug(Blog, title, id);
    }
  }
  if (updates.category !== undefined) {
    const category = normalizeBlogCategory(updates.category);
    if (category) updates.category = category;
    else if (updates.category === current.category || category === undefined) {
      // An older post's out-of-list category echoed back unchanged by the
      // form (or a blank) is left alone instead of failing the whole save.
      delete updates.category;
    } else return { error: INVALID_BLOG_CATEGORY };
  }
  if (updates.tags !== undefined) updates.tags = normalizeStringArray(updates.tags);
  if (updates.publishedAt === null || updates.publishedAt === '') delete updates.publishedAt;

  const visibility = resolveVisibilityInput(body);
  if (visibility.invalid) return { error: 'Invalid status' };
  if (visibility.provided) Object.assign(updates, blogVisibilityFields(visibility));

  return { updates };
};

const buildVideoUpdates = (body) => {
  const updates = pickDefined(body, [
    'title',
    'creatorId',
    'creatorName',
    'creatorAvatar',
    'duration',
    'category',
    'verified',
    'thumbnailUrl',
    'directMp4Url',
    'pollQuestion',
    'pollOptions',
    'publishedAt',
    'description',
    'tags',
  ]);

  if (body.summary !== undefined && updates.description === undefined)
    updates.description = body.summary;
  if (typeof updates.description === 'string') updates.description = updates.description.trim();
  if (updates.tags !== undefined) updates.tags = normalizeReelTags(updates.tags);
  if (body.imageUrl !== undefined && updates.thumbnailUrl === undefined)
    updates.thumbnailUrl = body.imageUrl;
  if (body.videoUrl !== undefined && updates.directMp4Url === undefined)
    updates.directMp4Url = body.videoUrl;
  if (updates.pollOptions !== undefined)
    updates.pollOptions = normalizePollOptions(updates.pollOptions);

  const visibility = resolveVisibilityInput(body);
  if (visibility.invalid) return { error: 'Invalid status' };
  if (visibility.provided) updates.isActive = visibility.value;

  return { updates };
};

const buildQuestionAnswerUpdates = async (body, id) => {
  const updates = pickDefined(body, [
    'question',
    'answer',
    'shortAnswer',
    'category',
    'subCategory',
    'bodyPart',
    'gender',
    'ageGroups',
    'tags',
    'symptoms',
    'relatedProducts',
    'difficultyLevel',
    'contentType',
    'language',
    'isSensitive',
    'isFeatured',
    'seoTitle',
    'seoDescription',
    'sourceLinks',
  ]);

  if (body.title !== undefined && updates.question === undefined) updates.question = body.title;
  if (body.content !== undefined && updates.answer === undefined) updates.answer = body.content;
  if (updates.question !== undefined) {
    const question = trimOrUndefined(updates.question);
    if (!question) return { error: 'question cannot be empty' };
    updates.question = question;
    // Same as blogs: only a real change of question moves the URL.
    const current = await QuestionAnswer.findById(id).select('question').lean();
    if (current && current.question !== question) {
      updates.slug = await createUniqueSlug(QuestionAnswer, question, id);
    }
  }
  if (updates.category !== undefined)
    updates.category = normalizeQuestionCategory(updates.category);
  ['bodyPart', 'gender', 'ageGroups', 'tags', 'symptoms', 'relatedProducts', 'sourceLinks'].forEach(
    (field) => {
      if (updates[field] !== undefined) updates[field] = normalizeStringArray(updates[field]);
    },
  );

  const visibility = resolveVisibilityInput(body);
  if (visibility.invalid) return { error: 'Invalid status' };
  if (visibility.provided) updates.isPublished = visibility.value;

  return { updates };
};

const buildHealthIssueUpdates = (body) => {
  if (!validateColor(body.color)) return { error: 'color must be a valid hex color' };

  const updates = pickDefined(body, [
    'title',
    'category',
    'icon',
    'color',
    'summary',
    'guide',
    'imageUrl',
    'order',
    'symptoms',
    'causes',
    'treatment',
    'prevention',
    'whenToSeeDoctor',
  ]);
  if (body.content !== undefined && updates.guide === undefined) updates.guide = body.content;
  if (body.coverImageUrl !== undefined && updates.imageUrl === undefined)
    updates.imageUrl = body.coverImageUrl;

  if (updates.symptoms !== undefined) updates.symptoms = normalizeStringArray(updates.symptoms);
  if (updates.causes !== undefined) updates.causes = normalizeStringArray(updates.causes);
  if (updates.treatment !== undefined) updates.treatment = trimOrUndefined(updates.treatment);
  if (updates.prevention !== undefined) updates.prevention = trimOrUndefined(updates.prevention);
  if (updates.whenToSeeDoctor !== undefined)
    updates.whenToSeeDoctor = trimOrUndefined(updates.whenToSeeDoctor);

  const visibility = resolveVisibilityInput(body);
  if (visibility.invalid) return { error: 'Invalid status' };
  if (visibility.provided) updates.isActive = visibility.value;

  return { updates };
};

const buildWellbeingUpdates = (body) => {
  if (!validateColor(body.color)) return { error: 'color must be a valid hex color' };

  const updates = pickDefined(body, [
    'type',
    'title',
    'icon',
    'color',
    'summary',
    'extendedGuide',
    'items',
    'order',
    'estimatedReadTime',
    'videoUrl',
    'audioUrl',
  ]);
  if (body.resourceType !== undefined && updates.type === undefined)
    updates.type = body.resourceType;
  if (body.content !== undefined && updates.extendedGuide === undefined)
    updates.extendedGuide = body.content;
  if (updates.extendedGuide !== undefined)
    updates.extendedGuide = normalizeStringArray(updates.extendedGuide);

  if (body.readTimeMinutes !== undefined && updates.estimatedReadTime === undefined) {
    updates.estimatedReadTime = Number(body.readTimeMinutes);
  }
  if (body.directMp4Url !== undefined && updates.videoUrl === undefined) {
    updates.videoUrl = body.directMp4Url;
  }

  const visibility = resolveVisibilityInput(body);
  if (visibility.invalid) return { error: 'Invalid status' };
  if (visibility.provided) updates.isActive = visibility.value;

  return { updates };
};

/* ---------------------------------------------------------------------------
 * Approval-gate helpers (used by routes/contentRoutes.js via withApproval)
 * ------------------------------------------------------------------------- */

/** Resolve `{ type, config, document }` for `/:type/:id`, or null. */
export const loadContentForRequest = async (req) => {
  const type = normalizeContentType(req.params.type);
  if (!type || !isValidObjectId(req.params.id)) return null;
  const config = CONTENT_CONFIG[type];
  const document = await config.Model.findById(req.params.id).select(REVIEW_ADMIN_SELECT);
  return document ? { type, config, document } : null;
};

/** True when the body would make the item visible in the app. */
export const bodyRequestsLive = (body = {}) => {
  const visibility = resolveVisibilityInput(body);
  return Boolean(visibility.provided && !visibility.invalid && visibility.value);
};

/** Is the item currently visible in the app? */
export const isContentLive = ({ config, document }) => Boolean(document[config.statusField]);

/** Serialized snapshot of an item, for the approvals diff view. */
export const snapshotContent = async (req) => {
  const loaded = await loadContentForRequest(req);
  if (!loaded) return undefined;
  return loaded.config.serialize(loaded.document, { includeBody: true });
};

/**
 * Staff without content.publish may only create drafts: strip any visibility
 * flags and pin the new item to its type's hidden state.
 */
export const forceDraftVisibility = (body = {}) => {
  const rest = { ...body };
  for (const field of [...VISIBILITY_FLAGS, 'status']) delete rest[field];
  return { ...rest, status: 'draft' };
};

export const updateContent = async (req, res, next) => {
  try {
    const type = normalizeContentType(req.params.type);
    if (!type) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content id');

    const config = CONTENT_CONFIG[type];
    const current = await config.Model.findById(req.params.id).select(REVIEW_ADMIN_SELECT).lean();
    if (!current) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

    const body = stripReviewFields(req.body);
    const updateBuilders = {
      blog: () => buildBlogUpdates(body, req.params.id),
      video: () => buildVideoUpdates(body),
      'question-answer': () => buildQuestionAnswerUpdates(body, req.params.id),
      'health-issue': () => buildHealthIssueUpdates(body),
      wellbeing: () => buildWellbeingUpdates(body),
    };

    const result = await updateBuilders[type]();
    if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);

    const { updates } = result;
    const reviewer = reviewerForRequest(req);
    let reviewAudit = null;
    // A non-reviewer changing the medical substance of a reviewed item
    // takes the stamp off: it needs re-review.
    const changedFields = changedReviewedFields(type, current, updates);
    if (shouldClearReviewStamp({ reviewer, stamped: current.medicallyReviewed, changedFields })) {
      Object.assign(updates, clearedReviewStamp());
      reviewAudit = { action: AUDIT_ACTIONS.CONTENT_REVIEW_CLEARED, metadata: { changedFields } };
    }
    // Going live ends any pending review; a reviewer publishing stamps it.
    if (updates[config.statusField] === true && !current[config.statusField]) {
      updates.inReview = false;
      if (reviewer) {
        Object.assign(updates, reviewStamp(reviewer));
        reviewAudit = {
          action: AUDIT_ACTIONS.CONTENT_REVIEW_APPROVED,
          metadata: { via: 'update', reviewerId: String(reviewer._id) },
        };
      }
    }
    if (type === 'blog' && updates.status === blogStatusEnum.ARCHIVED) updates.inReview = false;

    const document = await config.Model.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select(REVIEW_ADMIN_SELECT);

    if (!document) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.CONTENT_UPDATED,
      resourceType: type,
      resourceId: req.params.id,
    });
    if (reviewAudit) {
      await recordAudit({ req, ...reviewAudit, resourceType: type, resourceId: req.params.id });
    }
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Content updated',
      config.serialize(document, { includeBody: true }),
    );
  } catch (error) {
    next(error);
  }
};

export const setContentVisibility = async (req, res, next) => {
  try {
    const type = normalizeContentType(req.params.type);
    if (!type) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content id');

    const visibility = resolveVisibilityInput(req.body, true);
    if (visibility.invalid) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid status');
    if (visibility.inReview) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'Use POST /api/content/:type/:id/review to submit an item for medical review',
      );
    }

    const config = CONTENT_CONFIG[type];
    const current = await config.Model.findById(req.params.id).select(REVIEW_ADMIN_SELECT).lean();
    if (!current) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

    const updates =
      type === 'blog'
        ? blogVisibilityFields(visibility)
        : { [config.statusField]: visibility.value };
    if (type === 'video' && visibility.value) updates.publishedAt = new Date();
    // An explicit publish/unpublish takes the item out of the review queue.
    updates.inReview = false;
    // A reviewer (content.approve) publishing — directly, or by approving a
    // Content Admin's publish request — is its medical reviewer.
    const reviewer = reviewerForRequest(req);
    const stamping = Boolean(visibility.value && !current[config.statusField] && reviewer);
    if (stamping) Object.assign(updates, reviewStamp(reviewer));

    const document = await config.Model.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    }).select(REVIEW_ADMIN_SELECT);

    if (!document) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

    if (stamping) {
      await recordAudit({
        req,
        action: AUDIT_ACTIONS.CONTENT_REVIEW_APPROVED,
        resourceType: type,
        resourceId: req.params.id,
        metadata: { via: 'publish', reviewerId: String(reviewer._id) },
      });
    }

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Content visibility updated',
      config.serialize(document, { includeBody: true }),
    );
  } catch (error) {
    next(error);
  }
};

export const deleteContent = async (req, res, next) => {
  try {
    const type = normalizeContentType(req.params.type);
    if (!type) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content id');

    const config = CONTENT_CONFIG[type];
    const document = await config.Model.findByIdAndUpdate(
      req.params.id,
      { [config.statusField]: false },
      { new: true },
    ).select(REVIEW_ADMIN_SELECT);

    if (!document) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

    await recordAudit({
      req,
      action: AUDIT_ACTIONS.CONTENT_DELETED,
      resourceType: type,
      resourceId: req.params.id,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Content unpublished', config.serialize(document));
  } catch (error) {
    next(error);
  }
};

const REVIEW_AUDIT_ACTIONS = {
  [REVIEW_ACTIONS.SUBMIT]: AUDIT_ACTIONS.CONTENT_REVIEW_SUBMITTED,
  [REVIEW_ACTIONS.APPROVE]: AUDIT_ACTIONS.CONTENT_REVIEW_APPROVED,
  [REVIEW_ACTIONS.MARK_REVIEWED]: AUDIT_ACTIONS.CONTENT_REVIEW_MARKED,
  [REVIEW_ACTIONS.SEND_BACK]: AUDIT_ACTIONS.CONTENT_REVIEW_SENT_BACK,
};

const REVIEW_MESSAGES = {
  [REVIEW_ACTIONS.SUBMIT]: 'Submitted for medical review',
  [REVIEW_ACTIONS.APPROVE]: 'Approved and published',
  [REVIEW_ACTIONS.MARK_REVIEWED]: 'Marked as medically reviewed',
  [REVIEW_ACTIONS.SEND_BACK]: 'Sent back to draft',
};

/** Field updates for a review action, given the item as loaded now. */
const buildReviewUpdates = ({ action, type, config, current, user, note, now }) => {
  const actor = reviewerDisplayName(user);
  switch (action) {
    case REVIEW_ACTIONS.SUBMIT:
      return {
        inReview: true,
        reviewWorkflow: { submittedAt: now, submittedBy: actor, submittedById: user._id },
      };
    case REVIEW_ACTIONS.APPROVE:
      return {
        ...(type === 'blog'
          ? blogVisibilityFields({ value: true })
          : { [config.statusField]: true }),
        ...(type === 'video' ? { publishedAt: now } : {}),
        inReview: false,
        ...reviewStamp(user, { note, now }),
      };
    case REVIEW_ACTIONS.MARK_REVIEWED:
      return { inReview: false, ...reviewStamp(user, { note, now }) };
    case REVIEW_ACTIONS.SEND_BACK:
      return {
        inReview: false,
        ...clearedReviewStamp(),
        reviewWorkflow: {
          ...(current.reviewWorkflow || {}),
          sentBackAt: now,
          sentBackBy: actor,
          sentBackById: user._id,
          sentBackNote: note,
        },
      };
    default:
      return null;
  }
};

/**
 * POST /api/content/:type/:id/review — { action, note? }
 * submit (content.write): draft -> in_review
 * approve (content.approve): in_review -> published + stamp
 * mark_reviewed (content.approve): stamp, visibility unchanged
 * send_back (content.approve, note required): in_review -> draft
 */
export const reviewContent = async (req, res, next) => {
  try {
    const type = normalizeContentType(req.params.type);
    if (!type) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content id');

    const action = normalizeReviewAction(req.body?.action);
    if (!action) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'action must be one of: submit, approve, mark_reviewed, send_back',
      );
    }
    if (!canPerformReviewAction(req.user?.role, action)) {
      return sendError(
        res,
        HTTP_STATUS.FORBIDDEN,
        action === REVIEW_ACTIONS.SUBMIT
          ? 'You do not have permission to perform this action'
          : 'Only a medical reviewer (content.approve) can do this',
      );
    }
    const noteResult = normalizeReviewNote(req.body?.note, {
      required: action === REVIEW_ACTIONS.SEND_BACK,
    });
    if (noteResult.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, noteResult.error);

    const config = CONTENT_CONFIG[type];
    const current = await config.Model.findById(req.params.id).select(REVIEW_ADMIN_SELECT).lean();
    if (!current) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

    const live = Boolean(current[config.statusField]);
    const from = contentState({
      live,
      inReview: current.inReview,
      archived: type === 'blog' && current.status === blogStatusEnum.ARCHIVED,
    });
    const plan = planReviewTransition(action, from);
    if (!plan.ok) return sendError(res, HTTP_STATUS.CONFLICT, plan.error);

    const updates = buildReviewUpdates({
      action,
      type,
      config,
      current,
      user: req.user,
      note: noteResult.note,
      now: new Date(),
    });

    // Compare-and-set on the state planned from, so two reviewers (or a
    // reviewer and an editor) can't both apply a transition.
    const document = await config.Model.findOneAndUpdate(
      {
        _id: current._id,
        [config.statusField]: live ? true : { $ne: true },
        inReview: current.inReview ? true : { $ne: true },
      },
      updates,
      { new: true, runValidators: true },
    ).select(REVIEW_ADMIN_SELECT);
    if (!document) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'This item changed while you were reviewing it. Reload and try again.',
      );
    }

    await recordAudit({
      req,
      action: REVIEW_AUDIT_ACTIONS[action],
      resourceType: type,
      resourceId: req.params.id,
      metadata: { from, to: plan.nextState, hasNote: Boolean(noteResult.note) },
    });

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      REVIEW_MESSAGES[action],
      config.serialize(document, { includeBody: true }),
    );
  } catch (error) {
    next(error);
  }
};
