import QuestionAnswer from '../models/QuestionAnswer.js';
import User from '../models/User.js';
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

const DEFAULT_COMPANION_REPLY = 'That is a valid thing to wonder about. Try keywords like brown blood, period cramps, hygiene, intimacy, discharge, PMS, contraception, or cycle tracking so I can give a more specific answer.';

const fallbackKnowledge = [
  {
    keywords: ['brown', 'dark', 'black', 'blood', 'bleed'],
    answer: 'Dark brown blood is often normal at the start or end of a period. It is usually older blood leaving the uterus more slowly. If it comes with severe pain, bad odor, fever, or unusual discharge, it is worth checking with a clinician.',
  },
  {
    keywords: ['cup', 'tampon', 'hymen', 'virgin'],
    answer: 'A menstrual cup or tampon can stretch hymenal tissue, but virginity is not a medical measurement. Use the smallest comfortable size, go slowly, and stop if you feel pain.',
  },
  {
    keywords: ['poop', 'motions', 'stomach', 'loose', 'bowel'],
    answer: 'Changes in bowel movements around periods are common. Prostaglandins help the uterus contract and can also affect the bowel, which may cause cramps, loose stools, or more frequent bathroom trips.',
  },
  {
    keywords: ['sex', 'intimacy', 'intercourse', 'safe'],
    answer: 'Sex during a period can be safe when everyone involved is comfortable and consenting. Use protection because pregnancy and infections are still possible, and pause if there is pain or discomfort.',
  },
  {
    keywords: ['wash', 'soap', 'clean', 'vagina', 'smell', 'scent'],
    answer: 'Avoid scented washes, douching, or internal cleaning. The vagina is self-cleaning, and harsh products can disrupt pH. Warm water on the external vulva is usually enough.',
  },
];

const createUniqueSlug = async (question, existingId = null) => {
  const baseSlug = slugify(question, { lower: true, strict: true }).slice(0, 90) || `qa-${Date.now()}`;
  let slug = baseSlug;
  let suffix = 1;

  while (await QuestionAnswer.exists({
    slug,
    ...(existingId ? { _id: { $ne: existingId } } : {}),
  })) {
    slug = `${baseSlug}-${suffix}`;
    suffix += 1;
  }

  return slug;
};

export const createQuestionAnswer = async (req, res, next) => {
  try {
    const { question, answer, category } = req.body;

    if (!question?.trim() || !answer?.trim() || !category) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'question, answer, and category are required');
    }

    const slug = await createUniqueSlug(question);
    const qa = await QuestionAnswer.create({
      ...req.body,
      question: question.trim(),
      answer: answer.trim(),
      tags: normalizeStringArray(req.body.tags),
      symptoms: normalizeStringArray(req.body.symptoms),
      bodyPart: normalizeStringArray(req.body.bodyPart),
      gender: normalizeStringArray(req.body.gender),
      ageGroups: normalizeStringArray(req.body.ageGroups),
      slug,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Question answer created', qa);
  } catch (error) {
    next(error);
  }
};

export const getAllQuestionAnswers = async (req, res, next) => {
  try {
    const {
      search,
      category,
      gender,
      ageGroup,
      bodyPart,
      tags,
      featured,
    } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 10, maxLimit: 50 });

    const filter = { isPublished: true };

    if (search) {
      filter.$or = [
        { question: { $regex: escapeRegex(search), $options: 'i' } },
        { answer: { $regex: escapeRegex(search), $options: 'i' } },
        { tags: { $in: normalizeStringArray(search).map((tag) => new RegExp(escapeRegex(tag), 'i')) } },
      ];
    }
    if (category) filter.category = category;
    if (gender) filter.gender = gender;
    if (ageGroup) filter.ageGroups = ageGroup;
    if (bodyPart) filter.bodyPart = bodyPart;
    if (tags) filter.tags = { $in: normalizeStringArray(tags) };
    if (featured !== undefined) filter.isFeatured = featured === 'true';

    const [data, total] = await Promise.all([
      QuestionAnswer.find(filter)
        .sort({ isFeatured: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit),
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
    if (!query) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'question is required');
    }

    const qa = await QuestionAnswer.findOne({
      isPublished: true,
      $or: [
        { question: { $regex: escapeRegex(query), $options: 'i' } },
        { answer: { $regex: escapeRegex(query), $options: 'i' } },
        { tags: { $in: query.split(/\s+/).map((term) => new RegExp(escapeRegex(term), 'i')) } },
      ],
    }).sort({ isFeatured: -1, views: -1 });

    let answer = qa?.answer || '';
    if (!answer) {
      const lowered = query.toLowerCase();
      answer = fallbackKnowledge.find((entry) => entry.keywords.some((keyword) => lowered.includes(keyword)))?.answer
        || DEFAULT_COMPANION_REPLY;
    }

    if (qa) {
      qa.views += 1;
      await qa.save();
    }

    if (req.userId) {
      await User.findByIdAndUpdate(req.userId, { $inc: { tokenEarned: 2 } });
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Companion answer fetched', {
      question: query,
      answer,
      source: qa ? 'knowledge_base' : 'fallback',
      matchedQuestion: qa || null,
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

    qa.views += 1;
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
      'reviewedBy',
      'medicallyReviewed',
    ]);

    if (updates.question) {
      updates.slug = await createUniqueSlug(updates.question, req.params.id);
    }
    ['bodyPart', 'gender', 'ageGroups', 'tags', 'symptoms', 'relatedProducts', 'sourceLinks'].forEach((field) => {
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
      { new: true }
    );

    if (!qa) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Question not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Question unpublished successfully');
  } catch (error) {
    next(error);
  }
};
