import QuestionAnswer from '../models/QuestionAnswer.js';
import slugify from 'slugify';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  buildPagination,
  escapeRegex,
  getPagination,
  isValidObjectId,
  normalizeStringArray,
  pickDefined,
} from '../utils/apiHelpers.js';
import User from '../models/User.js';
import {
  COMPANION_DISCLAIMER,
  MAX_QUESTION_LENGTH,
  SUGGESTED_QUESTIONS,
  generateCompanionAnswer,
  getAgeBand,
} from '../utils/companionChat.js';

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

const normalizeQuestionCategory = (value) => {
  const normalized = String(value || 'general')
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, ' ');
  return QUESTION_CATEGORY_ALIASES[normalized] || normalized.replace(/\s+/g, '_');
};

const createUniqueSlug = async (question, existingId = null) => {
  const baseSlug =
    slugify(question, { lower: true, strict: true }).slice(0, 90) || `qa-${Date.now()}`;
  let slug = baseSlug;
  let suffix = 1;

  while (
    await QuestionAnswer.exists({
      slug,
      ...(existingId ? { _id: { $ne: existingId } } : {}),
    })
  ) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
};

export const createQuestionAnswer = async (req, res, next) => {
  try {
    const { question, answer } = req.body;
    const category = normalizeQuestionCategory(req.body.category);

    if (!question?.trim() || !answer?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'question and answer are required');
    }

    const slug = await createUniqueSlug(question);
    const qa = await QuestionAnswer.create({
      question: question.trim(),
      answer: answer.trim(),
      shortAnswer: req.body.shortAnswer,
      category,
      subCategory: req.body.subCategory,
      bodyPart: normalizeStringArray(req.body.bodyPart),
      gender: normalizeStringArray(req.body.gender),
      ageGroups: normalizeStringArray(req.body.ageGroups),
      tags: normalizeStringArray(req.body.tags),
      symptoms: normalizeStringArray(req.body.symptoms),
      relatedProducts: normalizeStringArray(req.body.relatedProducts),
      keywords: normalizeStringArray(req.body.keywords),
      difficultyLevel: req.body.difficultyLevel,
      contentType: req.body.contentType,
      language: req.body.language,
      isSensitive: req.body.isSensitive,
      isPublished: req.body.isPublished,
      isFeatured: req.body.isFeatured,
      sourceLinks: normalizeStringArray(req.body.sourceLinks),
      // reviewedBy/medicallyReviewed are server-written by the review flow
      // (POST /api/content/:type/:id/review), never taken from a body.
      seoTitle: req.body.seoTitle,
      seoDescription: req.body.seoDescription,
      slug,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Question answer created', qa);
  } catch (error) {
    next(error);
  }
};

export const getAllQuestionAnswers = async (req, res, next) => {
  try {
    const { search, category, gender, ageGroup, bodyPart, tags, featured } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 10, maxLimit: 50 });

    const filter = { isPublished: true };

    if (search) {
      filter.$or = [
        { question: { $regex: escapeRegex(search), $options: 'i' } },
        { answer: { $regex: escapeRegex(search), $options: 'i' } },
        {
          tags: {
            $in: normalizeStringArray(search).map((tag) => new RegExp(escapeRegex(tag), 'i')),
          },
        },
      ];
    }
    if (category) filter.category = category;
    if (gender) filter.gender = gender;
    if (ageGroup) filter.ageGroups = ageGroup;
    if (bodyPart) filter.bodyPart = bodyPart;
    if (tags) filter.tags = { $in: normalizeStringArray(tags) };
    if (featured !== undefined) filter.isFeatured = featured === 'true';

    const [data, total] = await Promise.all([
      QuestionAnswer.find(filter).sort({ isFeatured: -1, createdAt: -1 }).skip(skip).limit(limit),
      QuestionAnswer.countDocuments(filter),
    ]);

    return res.status(HTTP_STATUS.OK).json({
      success: true,
      statusCode: HTTP_STATUS.OK,
      message: 'Question answers fetched',
      data,
      questions: data,
      total,
      page,
      totalPages: Math.ceil(total / limit) || 0,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};

export const askQuestion = async (req, res, next) => {
  try {
    const query = (req.body.question || req.query.question || req.query.search || '').trim();
    const language = req.body.language || req.query.language;
    if (!query) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'question is required');
    }

    if (query.length > MAX_QUESTION_LENGTH) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        `question must be ${MAX_QUESTION_LENGTH} characters or fewer`,
      );
    }

    const { answer, source, personalized, matchedQuestion } = await generateCompanionAnswer({
      query,
      language,
      userId: req.userId,
      // Anonymous askers are 'unknown' and get the conservative, educational tone.
      ageBand: getAgeBand(req.user?.dateOfBirth),
    });

    let tokensAwarded = 0;
    if (req.userId) {
      await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 2 } });
      tokensAwarded = 2;
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Companion answer fetched', {
      question: query,
      answer,
      source,
      personalized,
      matchedQuestion,
      suggestedQuestions: SUGGESTED_QUESTIONS,
      disclaimer: COMPANION_DISCLAIMER,
      tokensAwarded,
    });
  } catch (error) {
    next(error);
  }
};

export const getSingleQuestionAnswer = async (req, res, next) => {
  try {
    const identifier = req.params.id;
    const filter = isValidObjectId(identifier) ? { _id: identifier } : { slug: identifier };
    const qa = await QuestionAnswer.findOne({ ...filter, isPublished: true });

    if (!qa) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Question not found');
    }

    qa.viewCount = Number(qa.viewCount || 0) + 1;
    await qa.save();

    return sendResponse(res, HTTP_STATUS.OK, 'Question answer fetched', qa);
  } catch (error) {
    next(error);
  }
};

export const updateQuestionAnswer = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid question id');
    }

    const updates = pickDefined(req.body, [
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
      'isPublished',
      'isFeatured',
      'seoTitle',
      'seoDescription',
      'sourceLinks',
    ]);

    if (updates.question) {
      updates.slug = await createUniqueSlug(updates.question, req.params.id);
    }
    if (updates.category !== undefined)
      updates.category = normalizeQuestionCategory(updates.category);
    [
      'bodyPart',
      'gender',
      'ageGroups',
      'tags',
      'symptoms',
      'relatedProducts',
      'sourceLinks',
    ].forEach((field) => {
      if (updates[field] !== undefined) updates[field] = normalizeStringArray(updates[field]);
    });

    const qa = await QuestionAnswer.findByIdAndUpdate(req.params.id, updates, {
      new: true,
      runValidators: true,
    });

    if (!qa) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Question not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Question answer updated', qa);
  } catch (error) {
    next(error);
  }
};

export const deleteQuestionAnswer = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid question id');
    }

    const qa = await QuestionAnswer.findByIdAndUpdate(
      req.params.id,
      { isPublished: false },
      { new: true },
    );

    if (!qa) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Question not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Question unpublished successfully');
  } catch (error) {
    next(error);
  }
};
