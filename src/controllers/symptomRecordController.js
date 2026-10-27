import SymptomRecord from '../models/SymptomRecord.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { clientTodayKey, isValidObjectId } from '../utils/apiHelpers.js';
import {
  MAX_RECORDS_PER_USER,
  parseStatusFilter,
  parseSymptomRecordInput,
  serializeSymptomRecord,
} from '../utils/symptomRecord.js';

/** GET /api/symptom-records — The person's Body Map symptoms, newest onset first */
export const listSymptomRecords = async (req, res, next) => {
  try {
    const status = parseStatusFilter(req.query.status);
    const filter = { userId: req.userId, ...(status && { status }) };
    const records = await SymptomRecord.find(filter)
      .sort({ onsetDate: -1, createdAt: -1 })
      .limit(MAX_RECORDS_PER_USER);
    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Symptoms fetched',
      records.map(serializeSymptomRecord),
    );
  } catch (error) {
    next(error);
  }
};

/** POST /api/symptom-records — Place a symptom on the body map */
export const createSymptomRecord = async (req, res, next) => {
  try {
    const { value, error } = parseSymptomRecordInput(req.body, { todayKey: clientTodayKey(req) });
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);

    const count = await SymptomRecord.countDocuments({ userId: req.userId });
    if (count >= MAX_RECORDS_PER_USER) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        'You have too many symptoms saved. Delete some old ones first.',
      );
    }

    const record = await SymptomRecord.create({ ...value, userId: req.userId });
    logger.info('symptom_record_created', { action: 'symptom_record_created', userId: req.userId });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Symptom saved', serializeSymptomRecord(record));
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/symptom-records/:id — Change a symptom, or mark it resolved */
export const updateSymptomRecord = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid symptom id');
    }
    const record = await SymptomRecord.findOne({ _id: req.params.id, userId: req.userId });
    if (!record) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Symptom not found');

    const { value, error } = parseSymptomRecordInput(req.body, {
      partial: true,
      todayKey: clientTodayKey(req),
      current: record.toJSON(),
    });
    if (error) return sendError(res, HTTP_STATUS.BAD_REQUEST, error);

    record.set(value);
    await record.save();
    return sendResponse(res, HTTP_STATUS.OK, 'Symptom updated', serializeSymptomRecord(record));
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/symptom-records/:id — Remove a symptom for good */
export const deleteSymptomRecord = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid symptom id');
    }
    const result = await SymptomRecord.deleteOne({ _id: req.params.id, userId: req.userId });
    if (!result.deletedCount) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Symptom not found');
    logger.info('symptom_record_deleted', { action: 'symptom_record_deleted', userId: req.userId });
    return sendResponse(res, HTTP_STATUS.OK, 'Symptom deleted', { deleted: true });
  } catch (error) {
    next(error);
  }
};
