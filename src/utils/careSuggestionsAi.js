import { createChatCompletion, isAiConfigured } from './sarvamClient.js';
import { buildDocumentContext } from './reportContext.js';
import { generateCareSuggestions as generateRuleBasedSuggestions } from './caringEngine.js';
import logger from './logger.js';

const RESPONSE_SCHEMA_HINT =
  'Respond with strict JSON only — no markdown, no code fences — matching exactly this shape: ' +
  '{"suggestions":[{"category":string,"title":string,"message":string}],"dos":[string],"donts":[string]}. ' +
  'Return at most 3 suggestions, 4 dos, and 3 donts.';

function buildLogContext(recentLogs) {
  if (!recentLogs?.length) return null;
  const lines = recentLogs.map((log) => {
    const parts = [log.dateKey];
    if (log.mood) parts.push(`mood: ${log.mood}`);
    if (log.flow && log.flow !== 'none') parts.push(`flow: ${log.flow}`);
    if (log.symptoms?.length) parts.push(`symptoms: ${log.symptoms.join(', ')}`);
    if (log.energy) parts.push(`energy: ${log.energy}`);
    if (typeof log.stressLevel === 'number') parts.push(`stress: ${log.stressLevel}/10`);
    if (typeof log.sleepHours === 'number') parts.push(`sleep: ${log.sleepHours}h`);
    if (typeof log.waterIntake === 'number') parts.push(`water: ${log.waterIntake}ml`);
    return parts.join(', ');
  });
  return `Recent daily logs (most recent first):\n${lines.join('\n')}`;
}

function stripCodeFences(text) {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return fenced ? fenced[1] : trimmed;
}

/** Generates the partner-facing "care suggestions" (tips + dos/don'ts) by
 * having Sarvam analyze the owner's recent cycle logs and (if permitted)
 * health-report documents. Always falls back to the existing rule-based
 * caringEngine when AI isn't configured, there's nothing to analyze, or the
 * call fails — care suggestions are a bonus layer, never a hard dependency
 * of the partner-view screen (same resilience pattern as the health report's
 * `analysis` field in reportController.js). */
export async function generateCareSuggestions({
  permissions,
  cycle,
  recentLogs,
  documents,
  useAi = true,
}) {
  const ruleBased = generateRuleBasedSuggestions(permissions, cycle, recentLogs);

  // `useAi: false` when the data's owner hasn't allowed AI processing.
  if (!useAi || !isAiConfigured()) return ruleBased;

  const sections = [];
  if (permissions.shareCyclePhase && cycle) {
    sections.push(
      `Current cycle phase: ${cycle.currentPhase}, day ${cycle.currentCycleDay}, next period in ${cycle.nextPeriodDaysAway} day(s).`,
    );
  }
  const logContext = permissions.shareSymptoms ? buildLogContext(recentLogs) : null;
  if (logContext) sections.push(logContext);
  if (permissions.shareReports && documents?.length) {
    sections.push(`Recent health report / document excerpts:\n${buildDocumentContext(documents)}`);
  }

  if (!sections.length) return ruleBased;

  try {
    const raw = await createChatCompletion({
      messages: [
        {
          role: 'system',
          content:
            "You are a caring assistant helping someone's romantic partner support them through their menstrual cycle and health. " +
            'Given her recent cycle phase, daily logs, and (if present) health report excerpts, write empathetic, concrete suggestions ' +
            'for how the partner can support her right now. Never invent facts not present in the data, and never restate raw medical ' +
            `document contents verbatim — summarize. ${RESPONSE_SCHEMA_HINT}`,
        },
        { role: 'user', content: sections.join('\n\n') },
      ],
      maxTokens: 800,
      temperature: 0.5,
    });

    const parsed = JSON.parse(stripCodeFences(raw));
    if (!Array.isArray(parsed?.suggestions) || parsed.suggestions.length === 0) {
      return ruleBased;
    }

    return {
      suggestions: parsed.suggestions.slice(0, 3),
      dos: Array.isArray(parsed.dos) ? parsed.dos.slice(0, 4) : [],
      donts: Array.isArray(parsed.donts) ? parsed.donts.slice(0, 3) : [],
    };
  } catch (error) {
    logger.error('partner_care_suggestions_ai_error', {
      action: 'partner_care_suggestions_ai_error',
      error: error.message,
    });
    return ruleBased;
  }
}
