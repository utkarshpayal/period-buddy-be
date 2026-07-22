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

const DEFAULT_COMPANION_REPLY = 'That is a valid thing to wonder about. I do not have a precise match yet, but you can ask in everyday words about brown blood, period cramps, hygiene, discharge, PMS, contraception, cycle tracking, or intimacy.';
const COMPANION_DISCLAIMER = 'Nura Companion shares general education and is not a diagnosis or emergency service.';
const MAX_QUESTION_LENGTH = 500;
const SUGGESTED_QUESTIONS = [
  'Is brown period blood normal?',
  'Why are cramps worse this month?',
  'How should I clean during my period?',
  'Can PMS affect mood?',
];
const STOP_WORDS = new Set([
  'about',
  'after',
  'again',
  'also',
  'and',
  'are',
  'because',
  'before',
  'but',
  'can',
  'does',
  'doing',
  'during',
  'for',
  'from',
  'have',
  'help',
  'into',
  'just',
  'like',
  'mean',
  'more',
  'much',
  'normal',
  'not',
  'period',
  'periods',
  'should',
  'that',
  'the',
  'their',
  'there',
  'this',
  'when',
  'where',
  'with',
  'what',
  'why',
  'will',
  'you',
  'your',
]);
// Below this, a "match" only overlaps on generic/common terms and is more likely
// to be noise than a genuine knowledge-base hit (e.g. off-topic questions that
// happen to share a filler word with a stored answer). See askQuestion().
const MIN_MATCH_SCORE = 15;
const URGENT_PATTERNS = [
  /\b(self[-\s]?harm|suicid(e|al)|kill myself)\b/i,
  /\b(bleeding during pregnancy|pregnant and bleeding)\b/i,
  /\b(soaking|fills?)\b.*\b(pad|pads|tampon|tampons)\b/i,
  /\b(faint|fainting|dizzy|dizziness)\b/i,
  /\b(fever|high temperature)\b.*\b(pelvic|period|cramp|pain)\b/i,
  /\b(severe|unbearable|worst)\b.*\b(pain|cramp|cramps)\b/i,
];
const URGENT_COMPANION_REPLY = 'This could need urgent help. If you are soaking pads quickly, feeling faint, have fever with pelvic pain, severe one-sided or unbearable pain, bleeding during pregnancy, or thoughts of self-harm, contact emergency care or a trusted local clinician now.';
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

const normalizeQueryTerms = (query) => {
  const normalized = query
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .map((term) => term.trim())
    .filter((term) => term.length >= 3 && !STOP_WORDS.has(term));

  return [...new Set(normalized)].slice(0, 8);
};

const hasUrgentPattern = (query) => URGENT_PATTERNS.some((pattern) => pattern.test(query));

const scoreQuestionAnswer = (qa, query, terms) => {
  const normalizedQuery = query.toLowerCase();
  const question = String(qa.question || '').toLowerCase();
  const answer = String(qa.answer || '').toLowerCase();
  const shortAnswer = String(qa.shortAnswer || '').toLowerCase();
  const tags = (qa.tags || []).join(' ').toLowerCase();
  const haystack = `${question} ${shortAnswer} ${answer} ${tags}`;
  let score = 0;

  if (question.includes(normalizedQuery)) score += 80;
  if (answer.includes(normalizedQuery)) score += 30;
  if (shortAnswer.includes(normalizedQuery)) score += 25;

  terms.forEach((term) => {
    if (question.includes(term)) score += 12;
    if (tags.includes(term)) score += 10;
    if (shortAnswer.includes(term)) score += 6;
    if (answer.includes(term)) score += 3;
  });

  if (terms.length > 1 && terms.every((term) => haystack.includes(term))) score += 12;
  if (qa.isFeatured) score += 4;
  score += Math.min(Number(qa.viewCount || 0), 100) / 100;

  return score;
};

const findBestQuestionAnswer = async (query) => {
  const terms = normalizeQueryTerms(query);
  const regexTerms = terms.length ? terms : [query].filter((term) => term.length >= 3);

  if (!regexTerms.length) return null;

  const termFilters = regexTerms.flatMap((term) => {
    const regex = new RegExp(escapeRegex(term), 'i');

    return [
      { question: regex },
      { answer: regex },
      { shortAnswer: regex },
      { tags: regex },
    ];
  });

  const candidates = await QuestionAnswer.find({
    isPublished: true,
    $or: termFilters,
  })
    .sort({ isFeatured: -1, viewCount: -1, updatedAt: -1 })
    .limit(16);

  const [best] = candidates
    .map((qa) => ({ qa, score: scoreQuestionAnswer(qa, query, terms) }))
    .filter((entry) => entry.score >= MIN_MATCH_SCORE)
    .sort((a, b) => b.score - a.score);

  return best?.qa || null;
};

const findFallbackAnswer = (query) => {
  const lowered = query.toLowerCase();
  return fallbackKnowledge.find((entry) => entry.keywords.some((keyword) => lowered.includes(keyword)))?.answer || '';
};

const normalizeQuestionCategory = (value) => {
  const normalized = String(value || 'general').trim().toLowerCase().replace(/[_-]+/g, ' ');
  return QUESTION_CATEGORY_ALIASES[normalized] || normalized.replace(/\s+/g, '_');
};

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
      reviewedBy: req.body.reviewedBy,
      medicallyReviewed: req.body.medicallyReviewed,
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

    if (query.length > MAX_QUESTION_LENGTH) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, `question must be ${MAX_QUESTION_LENGTH} characters or fewer`);
    }

    let qa = null;
    let answer = '';
    let source = 'fallback';

    if (hasUrgentPattern(query)) {
      answer = URGENT_COMPANION_REPLY;
      source = 'urgent_safety';
    } else {
      qa = await findBestQuestionAnswer(query);
      answer = qa?.answer || findFallbackAnswer(query) || DEFAULT_COMPANION_REPLY;
      source = qa ? 'knowledge_base' : 'fallback';
    }

    if (qa) {
      qa.viewCount = Number(qa.viewCount || 0) + 1;
      await qa.save();
    }

    let tokensAwarded = 0;
    if (req.userId) {
      await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 2 } });
      tokensAwarded = 2;
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Companion answer fetched', {
      question: query,
      answer,
      source,
      matchedQuestion: qa || null,
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
      'reviewedBy',
      'medicallyReviewed',
    ]);

    if (updates.question) {
      updates.slug = await createUniqueSlug(updates.question, req.params.id);
    }
    if (updates.category !== undefined) updates.category = normalizeQuestionCategory(updates.category);
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
