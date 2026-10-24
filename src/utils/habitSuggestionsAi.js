import { createChatCompletion, isAiConfigured } from './sarvamClient.js';
import { ageBandInstruction, withAiSafety } from './aiSafety.js';
import {
  CATEGORY_ICONS,
  MAX_SUGGESTIONS,
  STORED_SUGGESTIONS,
  SUGGESTION_REASON_MAX,
  SUGGESTION_TITLE_MAX,
  describeLogs,
  hasRecentLogs,
  parseAiHabits,
  suggestByRules,
} from './habitSuggestions.js';
import logger from './logger.js';

const GOAL_LABELS = {
  achieve_pregnancy: 'trying to get pregnant',
  avoid_pregnancy: 'avoiding pregnancy',
  general_health: 'general health',
  manage_symptoms: 'managing symptoms',
  track_period: 'tracking periods',
};

const iconList = Object.entries(CATEGORY_ICONS)
  .map(([category, icons]) => `${category}: ${icons.join(', ')}`)
  .join('; ');

const SYSTEM_PROMPT =
  "You are Nura, a gentle women's health companion. From the person's recent cycle logs, " +
  `today's cycle phase and goal, pick exactly ${MAX_SUGGESTIONS} small daily habits that would most help her feel better, ` +
  'most relevant first. Each must be one simple action she can tick off today (no medicines, supplements only if ' +
  'she is trying to conceive, nothing that needs a doctor). Start with habits that answer what her logs actually show ' +
  '(a symptom, mood, sleep, water, stress, flow, digestion, skin or activity pattern), strongest first; fill the rest with ' +
  'habits that suit her phase and goal today. Never repeat a habit she already has, and no two picks may be the same ' +
  'action reworded; spread them across sleep, food, movement, mind and care. ' +
  `Title: at most ${SUGGESTION_TITLE_MAX} characters, Title Case, starting with a verb. ` +
  `Reason: one plain sentence under ${SUGGESTION_REASON_MAX} characters on why, mentioning what she logged when it is the reason ` +
  '(e.g. "You logged cramps on 3 days lately"). Never diagnose. ' +
  `Category is one of sleep, nutrition, movement, mind, care; icon is one of the icons for that category (${iconList}). ` +
  'Respond with strict JSON only, no markdown or code fences, exactly: ' +
  '{"habits":[{"title":string,"reason":string,"category":string,"icon":string}]}';

/** The AI gets this long; past it the rules answer, so the screen never waits on a stuck call. */
export const AI_TIMEOUT_MS = 25_000;

const withTimeout = (promise, ms) => {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`AI timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
};

const stripCodeFences = (text) => {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
};

/**
 * Today's suggestions: the AI's when it may run and answers usefully, else
 * the rules'. Never throws. `{ source: 'ai' | 'rules', suggestions, aiFailed }`;
 * `aiFailed` is true only when the AI was allowed but failed or timed out.
 * `avoidTitles` are habits she dismissed or removed lately: never suggested.
 */
export async function generateHabitSuggestions({
  logs,
  todayKey,
  phase,
  goal,
  pregnancyMode = false,
  existingTitles = [],
  avoidTitles = [],
  ageBand,
  useAi = true,
}) {
  const rules = (aiFailed = false) => ({
    source: 'rules',
    aiFailed,
    suggestions: suggestByRules({
      logs,
      todayKey,
      phase,
      goal,
      existingTitles,
      avoidTitles,
      limit: STORED_SUGGESTIONS,
    }),
  });
  // Nothing logged: no picks at all (the app asks her to log instead).
  if (!hasRecentLogs(logs, todayKey)) return { source: 'rules', aiFailed: false, suggestions: [] };
  if (!useAi || !isAiConfigured()) return rules();

  const lines = describeLogs(logs, todayKey);
  const context = [
    `Today: ${todayKey}.`,
    pregnancyMode
      ? 'She is pregnant (pregnancy mode).'
      : phase
        ? `Cycle phase today: ${phase}.`
        : null,
    goal ? `Her goal: ${GOAL_LABELS[goal] || goal}.` : null,
    existingTitles.length
      ? `Habits she already has: ${existingTitles.join('; ')}.`
      : 'She has no habits yet.',
    avoidTitles.length
      ? `She said these are not for her, so suggest nothing like them: ${avoidTitles.join('; ')}.`
      : null,
    lines.length
      ? `Her logs from the last 2 weeks (newest first):\n${lines.join('\n')}`
      : 'She has logged nothing in the last 2 weeks.',
  ].filter(Boolean);

  try {
    const raw = await withTimeout(
      createChatCompletion({
        messages: [
          { role: 'system', content: withAiSafety(SYSTEM_PROMPT) + ageBandInstruction(ageBand) },
          { role: 'user', content: context.join('\n') },
        ],
        maxTokens: 1500,
        temperature: 0.5,
      }),
      AI_TIMEOUT_MS,
    );
    const aiPicks = parseAiHabits(
      JSON.parse(stripCodeFences(raw)),
      [...existingTitles, ...avoidTitles],
      STORED_SUGGESTIONS,
    );
    if (aiPicks.length === 0) return rules(true);
    // Always a full list: the rules fill any gap after the AI's picks, and
    // the extras step in as she adds or dismisses some.
    const extras = suggestByRules({
      logs,
      todayKey,
      phase,
      goal,
      existingTitles: [...existingTitles, ...aiPicks.map((p) => p.title)],
      avoidTitles,
      limit: STORED_SUGGESTIONS,
    });
    return {
      source: 'ai',
      aiFailed: false,
      suggestions: [...aiPicks, ...extras].slice(0, STORED_SUGGESTIONS),
    };
  } catch (error) {
    logger.error('habit_suggestions_ai_error', {
      action: 'habit_suggestions_ai_error',
      error: error.message,
    });
    return rules(true);
  }
}
