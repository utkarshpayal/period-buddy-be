import ScreeningAssessment from '../models/ScreeningAssessment.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import {
  SCREENING_CONDITIONS,
  SCREENING_QUESTIONS,
  SCREENING_DISCLAIMER,
} from '../constants/screeningQuestions.js';
import { assessScreening } from '../utils/screeningScoring.js';

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

const RED_FLAG_SUMMARY =
  ' Some of your answers are worth getting checked by a doctor soon, whatever the overall score.';

const buildSummary = (condition, riskLevel, score, { redFlags = [], note = null } = {}) => {
  const label = CONDITION_LABELS[condition] || condition;
  const riskText = {
    low: `Your responses matched few of the signs often linked with ${label} (score: ${score}/100). A low score does not rule it out: if any symptom worries you or keeps coming back, see a doctor.`,
    moderate: `Your responses show a moderate number of indicators sometimes associated with ${label} (score: ${score}/100).`,
    high: `Your responses show several indicators commonly associated with ${label} (score: ${score}/100).`,
  };
  return `${riskText[riskLevel]}${redFlags.length ? RED_FLAG_SUMMARY : ''}${note ? ` ${note}` : ''}`;
};

const buildDoctorDiscussionSummary = (condition, drivers, redFlagReasons = []) => {
  const label = CONDITION_LABELS[condition] || condition;
  if (redFlagReasons.length) {
    const flagged = redFlagReasons.map((reason) => `- ${reason}`).join('\n');
    const others = drivers.length
      ? `\n\nOther points to mention:\n${drivers.map((driver) => `- ${driver.text}`).join('\n')}`
      : '';
    return `Please talk to a doctor about these soon:\n${flagged}${others}`;
  }
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
    const { score, drivers, riskLevel, redFlags, redFlagReasons, note } = assessScreening(
      condition,
      questions,
      answers,
      { dateOfBirth: req.user?.dateOfBirth },
    );
    const summary = buildSummary(condition, riskLevel, score, { redFlags, note });
    const doctorDiscussionSummary = buildDoctorDiscussionSummary(
      condition,
      drivers,
      redFlagReasons,
    );

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
      redFlagCount: redFlags.length,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Screening assessment saved', {
      id: assessment._id,
      condition,
      score,
      riskLevel,
      summary,
      doctorDiscussionSummary,
      // Added fields (older clients ignore them): question ids of red-flag
      // answers, and an optional caveat (PCOS teen criteria).
      redFlags,
      note,
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
