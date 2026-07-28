import slugify from 'slugify';
import Blog from '../models/Blog.js';
import HealthIssue from '../models/HealthIssue.js';
import QuestionAnswer from '../models/QuestionAnswer.js';
import Reel from '../models/Reel.js';
import WellbeingResource from '../models/WellbeingResource.js';
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

const ACTIVE_STATUSES = new Set(['active', 'published', 'live', 'enabled']);
const INACTIVE_STATUSES = new Set(['inactive', 'draft', 'unpublished', 'archived', 'disabled']);
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

const resolveStatusFilter = (status) => {
  if (!status || String(status).toLowerCase() === 'all') return { valid: true, value: null };

  const normalized = String(status).trim().toLowerCase();
  if (ACTIVE_STATUSES.has(normalized)) return { valid: true, value: true };
  if (INACTIVE_STATUSES.has(normalized)) return { valid: true, value: false };

  return { valid: false, value: null };
};

const resolveVisibilityInput = (body, fallback) => {
  if (body.status !== undefined) {
    const resolved = resolveStatusFilter(body.status);
    if (!resolved.valid || resolved.value === null) return { provided: true, invalid: true };
    return { provided: true, value: resolved.value };
  }
  if (body.isPublished !== undefined) {
    return { provided: true, value: normalizeBoolean(body.isPublished) };
  }
  if (body.isActive !== undefined) {
    return { provided: true, value: normalizeBoolean(body.isActive) };
  }
  if (body.publish !== undefined) {
    return { provided: true, value: normalizeBoolean(body.publish) };
  }
  if (fallback !== undefined) return { provided: true, value: fallback };
  return { provided: false };
};

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
  const resolved = resolveStatusFilter(status);
  if (!resolved.valid) return false;
  if (resolved.value !== null) filter[statusField] = resolved.value;
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
    status: object.isPublished ? 'published' : 'draft',
    imageUrl: object.coverImageUrl,
    metrics: {
      views: object.viewCount || 0,
      likes: object.likeCount || 0,
    },
  };
};

const serializeVideo = (document) => {
  const object = toPlain(document);

  return {
    ...object,
    id: String(object._id),
    type: 'video',
    status: object.isActive ? 'active' : 'inactive',
    videoUrl: object.directMp4Url,
    imageUrl: object.thumbnailUrl,
    metrics: {
      views: object.viewCount || 0,
      likes: object.likeCount || 0,
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
    status: object.isPublished ? 'published' : 'draft',
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
    status: object.isActive ? 'active' : 'inactive',
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
    status: object.isActive ? 'active' : 'inactive',
  };
};

const buildBlogFilter = (query) => {
  const filter = {};
  if (!addVisibilityFilter(filter, query.status, 'isPublished')) return null;
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
      { type: 'blog', label: 'Blogs', statuses: ['published', 'draft'] },
      { type: 'video', label: 'Videos', aliases: ['reel'], statuses: ['active', 'inactive'] },
      {
        type: 'question-answer',
        label: 'Question Answers',
        aliases: ['qa'],
        statuses: ['published', 'draft'],
      },
      { type: 'health-issue', label: 'Health Issues', statuses: ['active', 'inactive'] },
      { type: 'wellbeing', label: 'Wellbeing Resources', statuses: ['active', 'inactive'] },
    ],
  });

export const getContentSummary = async (req, res, next) => {
  try {
    const entries = await Promise.all(
      CONTENT_TYPES.map(async (type) => {
        const config = CONTENT_CONFIG[type];
        const [total, active] = await Promise.all([
          config.Model.countDocuments(),
          config.Model.countDocuments({ [config.statusField]: true }),
        ]);

        return [
          type,
          {
            total,
            [config.activeName]: active,
            [config.inactiveName]: total - active,
          },
        ];
      }),
    );

    const byType = Object.fromEntries(entries);
    const total = entries.reduce((sum, [, value]) => sum + value.total, 0);

    return sendResponse(res, HTTP_STATUS.OK, 'Content summary fetched', {
      total,
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
        config.Model.find(filter).sort(config.sort).skip(skip).limit(limit),
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

        const documents = await config.Model.find(filter).sort(config.sort);

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
    const document = await config.Model.findOne(filter);
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

const createBlog = async (body) => {
  const title = trimOrUndefined(body.title);
  const content = trimOrUndefined(body.content);
  if (!title || !content) {
    return { error: 'title and content are required' };
  }

  const visibility = resolveVisibilityInput(body, CONTENT_CONFIG.blog.defaultActive);
  if (visibility.invalid) return { error: 'Invalid status' };

  const slug = await createUniqueSlug(Blog, title);
  const blog = await Blog.create({
    title,
    slug,
    content,
    excerpt: trimOrUndefined(body.excerpt),
    coverImageUrl: trimOrUndefined(body.coverImageUrl || body.imageUrl),
    category: trimOrUndefined(body.category) || 'General',
    tags: normalizeStringArray(body.tags),
    author: trimOrUndefined(body.author) || 'Period Buddy Team',
    readTimeMinutes: body.readTimeMinutes,
    seoTitle: trimOrUndefined(body.seoTitle),
    seoDescription: trimOrUndefined(body.seoDescription),
    keywords: normalizeStringArray(body.keywords),
    isPublished: visibility.value,
    publishedAt: visibility.value
      ? body.publishedAt
        ? new Date(body.publishedAt)
        : new Date()
      : null,
  });

  return { document: blog, serialize: serializeBlog };
};

const createVideo = async (body, user) => {
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
    isActive: visibility.value,
    publishedAt: body.publishedAt ? new Date(body.publishedAt) : new Date(),
  });

  return { document: video, serialize: serializeVideo };
};

const createQuestionAnswer = async (body) => {
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
    reviewedBy: trimOrUndefined(body.reviewedBy),
    medicallyReviewed: normalizeBoolean(body.medicallyReviewed),
    seoTitle: trimOrUndefined(body.seoTitle),
    seoDescription: trimOrUndefined(body.seoDescription),
    isPublished: visibility.value,
    slug,
  });

  return { document: qa, serialize: serializeQuestionAnswer };
};

const createHealthIssue = async (body) => {
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
  });

  return { document: issue, serialize: serializeHealthIssue };
};

const createWellbeing = async (body) => {
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
  });

  return { document: resource, serialize: serializeWellbeing };
};

export const createContent = async (req, res, next) => {
  try {
    const type = normalizeContentType(req.params.type);
    if (!type) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');

    const creators = {
      blog: () => createBlog(req.body),
      video: () => createVideo(req.body, req.user),
      'question-answer': () => createQuestionAnswer(req.body),
      'health-issue': () => createHealthIssue(req.body),
      wellbeing: () => createWellbeing(req.body),
    };

    const result = await creators[type]();
    if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);

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
    'readTimeMinutes',
    'seoTitle',
    'seoDescription',
    'keywords',
    'publishedAt',
  ]);

  if (body.imageUrl !== undefined && updates.coverImageUrl === undefined)
    updates.coverImageUrl = body.imageUrl;
  if (updates.title !== undefined) {
    const title = trimOrUndefined(updates.title);
    if (!title) return { error: 'title cannot be empty' };
    updates.title = title;
    updates.slug = await createUniqueSlug(Blog, title, id);
  }
  if (updates.tags !== undefined) updates.tags = normalizeStringArray(updates.tags);

  const visibility = resolveVisibilityInput(body);
  if (visibility.invalid) return { error: 'Invalid status' };
  if (visibility.provided) {
    updates.isPublished = visibility.value;
    if (visibility.value && updates.publishedAt === undefined) updates.publishedAt = new Date();
  }

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
  ]);

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
    'reviewedBy',
    'medicallyReviewed',
  ]);

  if (body.title !== undefined && updates.question === undefined) updates.question = body.title;
  if (body.content !== undefined && updates.answer === undefined) updates.answer = body.content;
  if (updates.question !== undefined) {
    const question = trimOrUndefined(updates.question);
    if (!question) return { error: 'question cannot be empty' };
    updates.question = question;
    updates.slug = await createUniqueSlug(QuestionAnswer, question, id);
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

export const updateContent = async (req, res, next) => {
  try {
    const type = normalizeContentType(req.params.type);
    if (!type) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content type');
    if (!isValidObjectId(req.params.id))
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid content id');

    const updateBuilders = {
      blog: () => buildBlogUpdates(req.body, req.params.id),
      video: () => buildVideoUpdates(req.body),
      'question-answer': () => buildQuestionAnswerUpdates(req.body, req.params.id),
      'health-issue': () => buildHealthIssueUpdates(req.body),
      wellbeing: () => buildWellbeingUpdates(req.body),
    };

    const result = await updateBuilders[type]();
    if (result.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, result.error);

    const config = CONTENT_CONFIG[type];
    const document = await config.Model.findByIdAndUpdate(req.params.id, result.updates, {
      new: true,
      runValidators: true,
    });

    if (!document) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

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

    const config = CONTENT_CONFIG[type];
    const updates = { [config.statusField]: visibility.value };
    if (type === 'blog' && visibility.value) updates.publishedAt = new Date();
    if (type === 'video' && visibility.value) updates.publishedAt = new Date();

    const document = await config.Model.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!document) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

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
    );

    if (!document) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Content not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Content unpublished', config.serialize(document));
  } catch (error) {
    next(error);
  }
};
