import express from 'express';
import * as symptomRecordController from '../controllers/symptomRecordController.js';
import { authenticate } from '../middleware/authMiddleware.js';

const router = express.Router();

/**
 * @route   GET /api/symptom-records
 * @desc    List the user's Body Map symptoms (?status=active|resolved)
 * @access  Private
 */
router.get('/', authenticate, symptomRecordController.listSymptomRecords);

/**
 * @route   POST /api/symptom-records
 * @desc    Save a symptom on a body region
 * @access  Private
 */
router.post('/', authenticate, symptomRecordController.createSymptomRecord);

/**
 * @route   PATCH /api/symptom-records/:id
 * @desc    Update a symptom or mark it resolved
 * @access  Private
 */
router.patch('/:id', authenticate, symptomRecordController.updateSymptomRecord);

/**
 * @route   DELETE /api/symptom-records/:id
 * @desc    Delete a symptom
 * @access  Private
 */
router.delete('/:id', authenticate, symptomRecordController.deleteSymptomRecord);

export default router;
