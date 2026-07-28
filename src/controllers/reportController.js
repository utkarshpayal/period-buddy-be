import CycleLog from '../models/CycleLog.js';
import Document from '../models/Document.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { createChatCompletion, isAiConfigured, getLanguageLabel } from '../utils/sarvamClient.js';
import { buildDocumentContext, buildCycleContext } from '../utils/reportContext.js';
import logger from '../utils/logger.js';

const MAX_CONTEXT_DOCS = 20;

const MOOD_LABELS = {
  happy: 'Happy',
  calm: 'Calm',
  emotional: 'Emotional',
  tired: 'Tired',
  sad: 'Sad',
  anxious: 'Anxious',
  irritable: 'Irritable',
  neutral: 'Neutral',
  energetic: 'Energetic',
};

const FLOW_LABELS = { heavy: 'Heavy', medium: 'Medium', light: 'Light', spotting: 'Spotting' };

function tally(values) {
  const counts = new Map();
  values.forEach((value) => {
    if (!value) return;
    counts.set(value, (counts.get(value) || 0) + 1);
  });
  return Array.from(counts.entries())
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);
}

function average(values) {
  const present = values.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  if (!present.length) return null;
  return Math.round((present.reduce((sum, v) => sum + v, 0) / present.length) * 10) / 10;
}

function trendPoints(logs, field) {
  return logs
    .filter((log) => typeof log[field] === 'number')
    .map((log) => ({ dateKey: log.dateKey, value: log[field] }));
}

/** POST /api/reports/health-report — a single aggregated payload (cycle-log
 * stats + uploaded-document breakdown + an AI analysis of both) for the
 * frontend's downloadable PDF report, so it never has to stitch together
 * multiple month-by-month calls itself. */
export const getHealthReport = async (req, res, next) => {
  try {
    const { startDate, endDate, language } = req.body;

    const start = startDate ? new Date(startDate) : null;
    const end = endDate ? new Date(endDate) : null;
    if (!start || Number.isNaN(start.getTime()) || !end || Number.isNaN(end.getTime())) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'A valid startDate and endDate are required');
    }
    end.setHours(23, 59, 59, 999);

    const startKey = String(startDate).slice(0, 10);
    const endKey = String(endDate).slice(0, 10);

    const [documents, logs] = await Promise.all([
      Document.find({ userId: req.userId, documentDate: { $gte: start, $lte: end } })
        .sort({ documentDate: 1 })
        .limit(MAX_CONTEXT_DOCS),
      CycleLog.find({ userId: req.userId, dateKey: { $gte: startKey, $lte: endKey } }).sort({
        dateKey: 1,
      }),
    ]);

    if (!documents.length && !logs.length) {
      return sendError(
        res,
        HTTP_STATUS.NOT_FOUND,
        'No cycle logs or documents found in that date range',
      );
    }

    const flowLogs = logs.filter((log) => log.flow && log.flow !== 'none');
    const cycle = {
      daysLogged: logs.length,
      periodDays: flowLogs.length,
      symptomCounts: tally(logs.flatMap((log) => log.symptoms || []))
        .slice(0, 8)
        .map((item) => ({
          ...item,
          label: item.label.charAt(0).toUpperCase() + item.label.slice(1),
        })),
      moodCounts: tally(logs.map((log) => log.mood)).map((item) => ({
        ...item,
        label: MOOD_LABELS[item.label] || item.label,
      })),
      flowCounts: tally(flowLogs.map((log) => log.flow)).map((item) => ({
        ...item,
        label: FLOW_LABELS[item.label] || item.label,
      })),
      averages: {
        sleepHours: average(logs.map((log) => log.sleepHours)),
        waterIntake: average(logs.map((log) => log.waterIntake)),
        stressLevel: average(logs.map((log) => log.stressLevel)),
      },
      trends: {
        sleepHours: trendPoints(logs, 'sleepHours'),
        waterIntake: trendPoints(logs, 'waterIntake'),
        stressLevel: trendPoints(logs, 'stressLevel'),
      },
    };

    let analysis = null;
    if (isAiConfigured() && (documents.length || cycle.daysLogged)) {
      try {
        const sections = [];
        if (documents.length)
          sections.push(`Uploaded documents:\n\n${buildDocumentContext(documents)}`);
        const cycleContext = buildCycleContext(cycle);
        if (cycleContext) sections.push(`Cycle tracker summary:\n\n${cycleContext}`);

        analysis = await createChatCompletion({
          messages: [
            {
              role: 'system',
              content:
                "You are a careful health assistant summarizing a patient's own uploaded medical reports and cycle-tracking data for their personal reference. Write a clear, plain-language analysis: call out abnormal lab values, medication changes, notable symptom patterns, and any follow-up actions. Never invent facts that are not present in the data. End with a short note that this is not medical advice." +
                (language && language !== 'en-IN'
                  ? ` Respond in ${getLanguageLabel(language)}, not English.`
                  : ''),
            },
            {
              role: 'user',
              content: `Analyze the following for the period ${startKey} to ${endKey}:\n\n${sections.join('\n\n---\n\n')}`,
            },
          ],
          maxTokens: 3000,
        });
      } catch (error) {
        logger.error('health_report_ai_error', { userId: req.userId, error: error.message });
        // Analysis is a bonus, not a hard requirement — a flaky AI call
        // shouldn't block the rest of the report.
      }
    }

    logger.info('health_report_generated', {
      action: 'health_report_generated',
      userId: req.userId,
      documentCount: documents.length,
      logCount: logs.length,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Health report generated', {
      documentCount: documents.length,
      documents: documents.map((d) => ({
        id: d._id,
        title: d.title,
        docType: d.docType,
        documentDate: d.documentDate,
      })),
      cycle,
      analysis,
    });
  } catch (error) {
    logger.error('health_report_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
