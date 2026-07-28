// routes/questionAnswer.routes.js

import express from 'express';

import {
  askQuestion,
  createQuestionAnswer,
  getAllQuestionAnswers,
  getSingleQuestionAnswer,
  updateQuestionAnswer,
  deleteQuestionAnswer,
} from '../controllers/questionAnswerController.js';
import { authenticate, authorize, optionalAuth } from '../middleware/authMiddleware.js';

const router = express.Router();

router.post('/', authenticate, authorize('admin'), createQuestionAnswer);

router.get('/', optionalAuth, getAllQuestionAnswers);

router.post('/ask', optionalAuth, askQuestion);

router.get('/:id', optionalAuth, getSingleQuestionAnswer);

router.put('/:id', authenticate, authorize('admin'), updateQuestionAnswer);

router.delete('/:id', authenticate, authorize('admin'), deleteQuestionAnswer);

export default router;
