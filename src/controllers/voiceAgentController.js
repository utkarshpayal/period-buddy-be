import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { createChatCompletion, isAiConfigured } from '../utils/sarvamClient.js';
import { upsertCycleLog } from './cycleController.js';

// Actions the voice agent is currently allowed to perform. Kept to a single
// action for now (per the initial "log today's entry" use case) so the
// response contract can grow additional actions later without breaking
// existing clients.
const SUPPORTED_ACTIONS = ['log_cycle_entry'];

const CYCLE_LOG_FIELDS = [
  'dateKey',
  'flow',
  'mood',
  'energy',
  'symptoms',
  'note',
  'isIntimate',
  'sleepHours',
  'waterIntake',
  'weight',
  'temperature',
  'stressLevel',
  'medication',
  'digestion',
  'skin',
  'discharge',
  'exercise',
];

const SYSTEM_PROMPT = `You are Buddy, the voice assistant inside a period-tracking app. The user is speaking to you out loud; your reply is spoken back to them, so keep it short and conversational.

You can either answer a question, or help the user log today's cycle entry through a short back-and-forth. Today's date (in the user's local time) is provided below — use it as the default "dateKey" unless the user names a different day.

You MUST reply with ONLY a single JSON object (no markdown, no extra text) matching exactly one of these shapes:

1. Answering a question or making small talk:
{"type": "answer", "text": "<spoken reply>"}

2. The user wants to log something (period flow, symptoms, mood, energy, sleep, water, weight, temperature, stress, medication, digestion, skin, discharge, exercise, intimacy, or a note) but you still need more information before you have enough to save:
{"type": "action_proposal", "action": "log_cycle_entry", "payload": {<any fields from ["dateKey","flow","mood","energy","symptoms","note","isIntimate","sleepHours","waterIntake","weight","temperature","stressLevel","medication","digestion","skin","discharge","exercise"] you already know>}, "followUpQuestion": "<one short question to ask next>"}

3. You have enough information to save the log and are ready for the user to confirm:
{"type": "action_confirm", "action": "log_cycle_entry", "payload": {<the fields to save>}, "confirmationText": "<summarize what you're about to log and ask them to confirm>"}

Rules:
- Never invent field values the user didn't say or clearly imply.
- flow must be one of: none, light, medium, heavy, spotting. mood: happy, calm, emotional, tired, sad, anxious, irritable, neutral, energetic. energy: low, medium, steady, high. digestion: normal, constipated, diarrhea, bloated. skin: clear, oily, dry, acne. discharge: none, sticky, creamy, watery, egg-white.
- symptoms, medication, and exercise are free-text lists.
- Once the user says yes/confirm/save it to a type "action_confirm" message you sent, move on — do not ask again.
- If the user is just asking a question (e.g. "how do I know if my PMS is normal?"), always use type "answer".`;

const languageInstruction = (language) =>
  language && language !== 'en-IN' ? `\n\nReply in the language with code "${language}".` : '';

const parseAgentReply = (raw) => {
  try {
    // Models occasionally wrap JSON in a code fence despite instructions.
    const cleaned = raw
      .trim()
      .replace(/^```json\s*/i, '')
      .replace(/^```\s*/i, '')
      .replace(/```$/, '');
    const parsed = JSON.parse(cleaned);
    if (parsed && typeof parsed === 'object' && parsed.type) {
      return parsed;
    }
  } catch {
    // Fall through to the plain-text fallback below.
  }
  return { type: 'answer', text: raw.trim() };
};

const todayDateKey = () => new Date().toISOString().slice(0, 10);

/** POST /api/voice-agent/converse — one turn of the voice agent conversation */
export const converse = async (req, res, next) => {
  try {
    const { transcript, language, pendingAction, confirmed } = req.body;

    if (!transcript || !transcript.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'transcript is required');
    }

    // The client is confirming a previously-proposed action — execute it
    // directly without another AI round-trip.
    if (confirmed && pendingAction?.action && pendingAction?.payload) {
      if (!SUPPORTED_ACTIONS.includes(pendingAction.action)) {
        return sendError(
          res,
          HTTP_STATUS.BAD_REQUEST,
          `Unsupported action: ${pendingAction.action}`,
        );
      }
      const payload = { dateKey: todayDateKey(), ...pendingAction.payload };
      const { cycleLog, tokensEarned } = await upsertCycleLog(req.userId, payload);
      return sendResponse(res, HTTP_STATUS.OK, 'Action executed', {
        type: 'action_result',
        action: pendingAction.action,
        text: "Done — I've logged that for you.",
        cycleLog,
        tokensEarned,
      });
    }

    if (!isAiConfigured()) {
      return sendError(
        res,
        HTTP_STATUS.SERVICE_UNAVAILABLE,
        'Voice agent is not configured on the server',
      );
    }

    const contextLines = [`Today's dateKey is ${todayDateKey()}.`];
    if (pendingAction?.payload) {
      contextLines.push(
        `So far for this in-progress log entry you have gathered: ${JSON.stringify(pendingAction.payload)}.`,
      );
    }

    const reply = await createChatCompletion({
      messages: [
        {
          role: 'system',
          content: SYSTEM_PROMPT + languageInstruction(language) + `\n\n${contextLines.join(' ')}`,
        },
        { role: 'user', content: transcript },
      ],
      maxTokens: 500,
    });

    const agentReply = parseAgentReply(reply);

    if (agentReply.type === 'action_proposal' || agentReply.type === 'action_confirm') {
      if (!SUPPORTED_ACTIONS.includes(agentReply.action)) {
        return sendResponse(res, HTTP_STATUS.OK, 'Agent replied', {
          type: 'answer',
          text: agentReply.text || "Sorry, I can't do that yet.",
        });
      }
      // Drop any fields the model hallucinated outside the allowed set.
      agentReply.payload = Object.fromEntries(
        Object.entries(agentReply.payload || {}).filter(([key]) => CYCLE_LOG_FIELDS.includes(key)),
      );
    }

    logger.info('voice_agent_turn', {
      action: 'voice_agent_turn',
      userId: req.userId,
      replyType: agentReply.type,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Agent replied', agentReply);
  } catch (error) {
    logger.error('voice_agent_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
