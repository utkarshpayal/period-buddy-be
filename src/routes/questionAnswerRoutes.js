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
import {
  createChatSession,
  deleteChatSession,
  getChatSession,
  listChatSessions,
  sendChatSessionMessage,
} from '../controllers/chatSessionController.js';
import { authenticate, optionalAuth } from '../middleware/authMiddleware.js';
import { requirePermission } from '../middleware/rbac.js';
import { PERMISSIONS } from '../config/permissions.js';
import { requireAiConsent } from '../utils/privacy.js';
import { fairUse } from '../middleware/subscriptionMiddleware.js';

const router = express.Router();

router.post(
  '/',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  createQuestionAnswer,
);

router.get('/', optionalAuth, getAllQuestionAnswers);

// Each AI answer counts toward the daily fair-use allowance (signed-in only).
router.post('/ask', optionalAuth, requireAiConsent, fairUse('ai_message'), askQuestion);

// Persisted, topic-scoped Nura Companion chat sessions — chat history the
// user can reopen and continue, one per topic (or 'general'). All
// login-gated since this is per-user history, unlike the anonymous-friendly
// /ask above. Mounted ahead of the generic /:id so "sessions" never gets
// swallowed as a QuestionAnswer id/slug lookup.
// New sessions/messages are gated behind 'ai_assistant' via the global
// feature-route registry (config/subscriptionRouteRegistry.js) — free until
// an admin marks it premium; reading/deleting a session you already have
// stays free regardless — you already paid for that history.
router.post('/sessions', authenticate, requireAiConsent, createChatSession);
router.get('/sessions', authenticate, listChatSessions);
router.get('/sessions/:id', authenticate, getChatSession);
router.post(
  '/sessions/:id/messages',
  authenticate,
  requireAiConsent,
  fairUse('ai_message'),
  sendChatSessionMessage,
);
router.delete('/sessions/:id', authenticate, deleteChatSession);

router.get('/:id', optionalAuth, getSingleQuestionAnswer);

router.put(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  updateQuestionAnswer,
);

router.delete(
  '/:id',
  authenticate,
  requirePermission(PERMISSIONS.CONTENT_PUBLISH),
  deleteQuestionAnswer,
);

export default router;
