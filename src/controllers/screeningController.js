import ScreeningAssessment from '../models/ScreeningAssessment.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import {
  SCREENING_CONDITIONS,
  SCREENING_QUESTIONS,
  SCREENING_DISCLAIMER,
  getRiskLevel,
} from '../constants/screeningQuestions.js';

const CONDITION_LABELS = {
  pcos: 'PCOS',
  endometriosis: 'endometriosis',
  fibroid: 'uterine fibroids',
  thyroid: 'a thyroid condition',
};

/** GET /api/screening/questions?condition=pcos — Static question set for a condition */
export const getQuestions = async (req, res, next) => {
  try {
    const { condition } = req.query;

    if (!condition || !SCREENING_CONDITIONS.includes(condition)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        `condition must be one of: ${SCREENING_CONDITIONS.join(', ')}`,
      );
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Screening questions fetched', {
      condition,
      questions: SCREENING_QUESTIONS[condition],
      disclaimer: SCREENING_DISCLAIMER,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Deterministic weighted-sum scoring — no AI call. Each question's `weight`
 * is fully scored for a truthy boolean answer, or proportionally scored
 * (answer / 3) for a 0-3 scale answer.
 */
const scoreAnswers = (questions, answers) => {
  let earned = 0;
  let possible = 0;
  const drivers = [];

  questions.forEach((question) => {
    possible += question.weight;
    const raw = answers?.[question.id];

    if (question.type === 'boolean') {
      const value = raw === true || raw === 'true' || raw === 1;
      if (value) {
        earned += question.weight;
        drivers.push({ text: question.text, contributed: question.weight });
      }
    } else if (question.type === 'scale') {
      const value = Math.min(3, Math.max(0, Number(raw) || 0));
      const contributed = (value / 3) * question.weight;
      earned += contributed;
      if (value >= 2) {
        drivers.push({ text: question.text, contributed: Math.round(contributed) });
      }
    }
  });

  const score = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  return { score, drivers };
};

const buildSummary = (condition, riskLevel, score) => {
  const label = CONDITION_LABELS[condition] || condition;
  const riskText = {
    low: `Your responses matched few of the signs often linked with ${label} (score: ${score}/100). A low score does not rule it out: if any symptom worries you or keeps coming back, see a doctor.`,
    moderate: `Your responses show a moderate number of indicators sometimes associated with ${label} (score: ${score}/100).`,
    high: `Your responses show several indicators commonly associated with ${label} (score: ${score}/100).`,
  };
  return riskText[riskLevel];
};

const buildDoctorDiscussionSummary = (condition, drivers) => {
  const label = CONDITION_LABELS[condition] || condition;
  if (drivers.length === 0) {
    return `No major ${label} indicators were flagged from this screening. Discuss any ongoing symptoms with your doctor if they persist.`;
  }
  const bullets = drivers.map((driver) => `- ${driver.text}`).join('\n');
  return `Points to discuss with your doctor regarding ${label}:\n${bullets}`;
};

/** POST /api/screening/assess — Score answers and save an assessment */
export const submitAssessment = async (req, res, next) => {
  try {
    const { condition, answers } = req.body;

    if (!condition || !SCREENING_CONDITIONS.includes(condition)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        `condition must be one of: ${SCREENING_CONDITIONS.join(', ')}`,
      );
    }
    if (!answers || typeof answers !== 'object' || Array.isArray(answers)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'answers must be an object keyed by questionId',
      );
    }

    const questions = SCREENING_QUESTIONS[condition];
    const { score, drivers } = scoreAnswers(questions, answers);
    const riskLevel = getRiskLevel(score);
    const summary = buildSummary(condition, riskLevel, score);
    const doctorDiscussionSummary = buildDoctorDiscussionSummary(condition, drivers);

    const assessment = await ScreeningAssessment.create({
      userId: req.userId,
      condition,
      answers,
      score,
      riskLevel,
      summary,
      doctorDiscussionSummary,
    });

    logger.info('screening_assessment_created', {
      action: 'screening_assessment_created',
      userId: req.userId,
      condition,
      score,
      riskLevel,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Screening assessment saved', {
      id: assessment._id,
      condition,
      score,
      riskLevel,
      summary,
      doctorDiscussionSummary,
      disclaimer: SCREENING_DISCLAIMER,
      createdAt: assessment.createdAt,
    });
  } catch (error) {
    logger.error('screening_assessment_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** GET /api/screening/history — User's past assessments, newest first */
export const getHistory = async (req, res, next) => {
  try {
    const assessments = await ScreeningAssessment.find({ userId: req.userId }).sort({
      createdAt: -1,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Screening history fetched', assessments);
  } catch (error) {
    next(error);
  }
};
