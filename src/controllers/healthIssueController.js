import HealthIssue from '../models/HealthIssue.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { HEX_COLOR_REGEX, isValidObjectId, pickDefined } from '../utils/apiHelpers.js';

/** GET /api/health-issues — List all health issues */
export const getHealthIssues = async (req, res, next) => {
  try {
    const issues = await HealthIssue.find({ isActive: true }).sort({ order: 1, createdAt: 1 });

    logger.info('health_issues_fetched', { action: 'health_issues_fetched', count: issues.length });

    return sendResponse(res, HTTP_STATUS.OK, 'Health issues fetched', issues);
  } catch (error) {
    next(error);
  }
};

/** GET /api/health-issues/:id — Get single health issue */
export const getHealthIssueById = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid health issue id');
    }

    const issue = await HealthIssue.findOne({ _id: req.params.id, isActive: true });
    if (!issue) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Health issue not found');

    return sendResponse(res, HTTP_STATUS.OK, 'Health issue', issue);
  } catch (error) {
    next(error);
  }
};

/** POST /api/health-issues — Admin: Create health issue */
export const createHealthIssue = async (req, res, next) => {
  try {
    const { title, category, icon, color, summary, guide, imageUrl, order } = req.body;

    if (!title || !category || !summary || !guide) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'title, category, summary, and guide are required');
    }
    if (color && !HEX_COLOR_REGEX.test(color)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'color must be a valid hex color');
    }

    const issue = await HealthIssue.create({ title, category, icon, color, summary, guide, imageUrl, order });

    logger.info('health_issue_created', { action: 'health_issue_created', id: issue._id, title });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Health issue created', issue);
  } catch (error) {
    next(error);
  }
};

/** PUT /api/health-issues/:id — Admin: Update health issue */
export const updateHealthIssue = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid health issue id');
    }
    if (req.body.color && !HEX_COLOR_REGEX.test(req.body.color)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'color must be a valid hex color');
    }

    const updates = pickDefined(req.body, ['title', 'category', 'icon', 'color', 'summary', 'guide', 'imageUrl', 'order', 'isActive']);
    const issue = await HealthIssue.findByIdAndUpdate(req.params.id, updates, { new: true, runValidators: true });
    if (!issue) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Health issue not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Health issue updated', issue);
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/health-issues/:id — Admin: Soft delete health issue */
export const deleteHealthIssue = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid health issue id');
    }

    const issue = await HealthIssue.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
    if (!issue) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Health issue not found');
    return sendResponse(res, HTTP_STATUS.OK, 'Health issue deleted');
  } catch (error) {
    next(error);
  }
};
