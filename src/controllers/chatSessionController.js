import QaChatSession from '../models/QaChatSession.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import {
  CHAT_TOPICS,
  COMPANION_DISCLAIMER,
  MAX_QUESTION_LENGTH,
  SUGGESTED_QUESTIONS,
  generateCompanionAnswer,
  isKnownTopicId,
  isTopicAgeRestricted,
} from '../utils/companionChat.js';

// How many prior turns (user+assistant pairs) from this session are replayed
// back to the model as conversational context on a follow-up question.
// Keeps token usage bounded on long-running sessions.
const MAX_HISTORY_MESSAGES = 12;

const toSessionSummary = (session) => ({
  id: session._id,
  topicId: session.topicId,
  topicLabel: session.topicLabel,
  title: session.title || session.topicLabel,
  messageCount: session.messages.length,
  lastMessageAt: session.lastMessageAt,
  createdAt: session.createdAt,
});

const toMessagePayload = (message) => ({
  id: message._id,
  role: message.role,
  text: message.text,
  source: message.source,
  personalized: message.personalized,
  disclaimer: message.disclaimer,
  suggestedQuestions: message.suggestedQuestions,
  createdAt: message.createdAt,
});

const deriveTitle = (question) => {
  const clean = question.trim().replace(/\s+/g, ' ');
  return clean.length > 60 ? `${clean.slice(0, 57)}...` : clean;
};

const loadOwnedSession = async (req, res) => {
  if (!isValidObjectId(req.params.id)) {
    sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid chat session id');
    return null;
  }
  const session = await QaChatSession.findById(req.params.id);
  if (!session || String(session.userId) !== String(req.userId)) {
    sendError(res, HTTP_STATUS.NOT_FOUND, 'Chat session not found');
    return null;
  }
  return session;
};

// POST /api/questions/sessions — start a new chat, optionally pinned to a
// topic chip (see CHAT_TOPICS). Created empty; the first message fills in
// the title. Kept separate from sendSessionMessage so the frontend can open
// an empty "topic picked" screen state before the user has typed anything.
export const createChatSession = async (req, res, next) => {
  try {
    const requestedTopicId = req.body.topicId;
    const topicId =
      requestedTopicId && isKnownTopicId(requestedTopicId) ? requestedTopicId : 'general';
    const topicLabel = CHAT_TOPICS[topicId]?.label || 'General';

    if (CHAT_TOPICS[topicId]?.minAge) {
      const asker = await User.findById(req.userId).select('dateOfBirth');
      if (isTopicAgeRestricted(topicId, asker?.dateOfBirth)) {
        return sendError(
          res,
          HTTP_STATUS.FORBIDDEN,
          `${topicLabel} is only available once your profile shows you're ${CHAT_TOPICS[topicId].minAge}+. Update your date of birth in your profile to unlock it.`,
        );
      }
    }

    const session = await QaChatSession.create({
      userId: req.userId,
      topicId,
      topicLabel,
    });

    return sendResponse(
      res,
      HTTP_STATUS.CREATED,
      'Chat session created',
      toSessionSummary(session),
    );
  } catch (error) {
    next(error);
  }
};

// GET /api/questions/sessions — chat history list, most recently active first.
export const listChatSessions = async (req, res, next) => {
  try {
    const sessions = await QaChatSession.find({ userId: req.userId })
      .sort({ lastMessageAt: -1 })
      .limit(100);

    return sendResponse(
      res,
      HTTP_STATUS.OK,
      'Chat sessions fetched',
      sessions.map(toSessionSummary),
    );
  } catch (error) {
    next(error);
  }
};

// GET /api/questions/sessions/:id — full session with its messages, to
// resume a past conversation.
export const getChatSession = async (req, res, next) => {
  try {
    const session = await loadOwnedSession(req, res);
    if (!session) return;

    return sendResponse(res, HTTP_STATUS.OK, 'Chat session fetched', {
      ...toSessionSummary(session),
      messages: session.messages.map(toMessagePayload),
    });
  } catch (error) {
    next(error);
  }
};

// POST /api/questions/sessions/:id/messages — ask a question inside an
// existing session. Scoped to the session's topic (see
// generateCompanionAnswer/topicScopeInstruction) and given the recent turns
// of this same session as context, so it reads as one continuous
// conversation instead of stateless one-off answers.
export const sendChatSessionMessage = async (req, res, next) => {
  try {
    const session = await loadOwnedSession(req, res);
    if (!session) return;

    const query = (req.body.question || '').trim();
    const language = req.body.language;
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

    const history = session.messages.slice(-MAX_HISTORY_MESSAGES).map((message) => ({
      role: message.role === 'assistant' ? 'assistant' : 'user',
      content: message.text,
    }));

    const { answer, source, personalized, matchedQuestion } = await generateCompanionAnswer({
      query,
      language,
      userId: req.userId,
      topicId: session.topicId,
      history,
    });

    session.messages.push({ role: 'user', text: query });
    session.messages.push({
      role: 'assistant',
      text: answer,
      source,
      personalized,
      disclaimer: COMPANION_DISCLAIMER,
      suggestedQuestions: SUGGESTED_QUESTIONS,
    });
    session.lastMessageAt = new Date();
    if (!session.title) session.title = deriveTitle(query);
    await session.save();

    let tokensAwarded = 0;
    if (req.userId) {
      await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: 2 } });
      tokensAwarded = 2;
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Companion answer fetched', {
      session: toSessionSummary(session),
      question: query,
      answer,
      source,
      personalized,
      matchedQuestion: matchedQuestion || null,
      suggestedQuestions: SUGGESTED_QUESTIONS,
      disclaimer: COMPANION_DISCLAIMER,
      tokensAwarded,
    });
  } catch (error) {
    next(error);
  }
};

// DELETE /api/questions/sessions/:id — remove one chat from history.
export const deleteChatSession = async (req, res, next) => {
  try {
    const session = await loadOwnedSession(req, res);
    if (!session) return;

    await session.deleteOne();

    return sendResponse(res, HTTP_STATUS.OK, 'Chat session deleted');
  } catch (error) {
    next(error);
  }
};
