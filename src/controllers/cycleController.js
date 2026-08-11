import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { createPartnerNotification } from './partnerController.js';
import {
  dateFromDateKey,
  normalizeStringArray,
  pickDefined,
  validateDateKey,
  validateMonthKey,
} from '../utils/apiHelpers.js';
import {
  buildCycleAnalytics,
  calculateTrackingStreak,
  computeCyclePredictions,
  diffDays,
  getCyclePhase,
} from '../utils/cycle.js';

/* ──────────────────────────────────────────────
   Controllers
────────────────────────────────────────────── */

/**
 * Shared upsert used by both the REST endpoint (saveCycleLog) and the voice
 * agent's log_cycle_entry action, so there is exactly one place that computes
 * cycleDay/phase and applies reward points/streak/partner-notification
 * side effects for a day's log.
 */
export const upsertCycleLog = async (userId, payload) => {
  const {
    dateKey,
    flow,
    mood,
    energy,
    symptoms,
    note,
    isIntimate,
    sleepHours,
    waterIntake,
    weight,
    temperature,
    stressLevel,
    medication,
    digestion,
    digestions,
    skin,
    skins,
    discharge,
    exercise,
    moods,
    timezoneOffsetMinutes,
  } = payload;

  // The client's local "today" — day logs are keyed by local date, so the
  // streak must anchor to the user's local date, not server UTC. `timezone
  // OffsetMinutes` is Date.prototype.getTimezoneOffset() from the client
  // (UTC−local, e.g. −330 for IST). Falls back to UTC when absent.
  const tzOffset = Number(timezoneOffsetMinutes);
  const clientTodayKey = Number.isFinite(tzOffset)
    ? new Date(Date.now() - tzOffset * 60000).toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  if (!dateKey || !validateDateKey(dateKey)) {
    throw Object.assign(new Error('dateKey is required (YYYY-MM-DD)'), {
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }

  const date = dateFromDateKey(dateKey);
  const settings = await CycleSettings.findOne({ userId });
  // Offset (in days) from the tracked cycle start; can be negative for dates
  // logged before lastPeriodStartDate (e.g. backfilled history).
  const cycleLength = settings?.cycleLength || 28;
  const offset = settings ? diffDays(date, settings.lastPeriodStartDate) : undefined;
  // Wrap with a true modulo (not JS's remainder, which keeps the sign of the
  // dividend) so dates before the tracked start land on the correct day of the
  // *previous* cycle instead of all collapsing onto cycleDay 1 / "period".
  const normalizedCycleDay =
    offset !== undefined ? (((offset % cycleLength) + cycleLength) % cycleLength) + 1 : undefined;
  const phase = normalizedCycleDay
    ? getCyclePhase(normalizedCycleDay, settings?.periodLength || 5, cycleLength)
    : undefined;

  const isNewLog = !(await CycleLog.findOne({ userId, dateKey }));
  const tokensEarned = isNewLog ? 5 : 1;
  const update = pickDefined(
    {
      date,
      flow,
      mood,
      moods: moods !== undefined ? normalizeStringArray(moods) : undefined,
      energy,
      symptoms: normalizeStringArray(symptoms),
      note: note?.trim(),
      isIntimate: typeof isIntimate === 'boolean' ? isIntimate : undefined,
      cycleDay: normalizedCycleDay,
      phase,
      rewardPoints: tokensEarned,
      sleepHours,
      waterIntake,
      weight,
      temperature,
      stressLevel,
      medication: medication !== undefined ? normalizeStringArray(medication) : undefined,
      digestion,
      digestions: digestions !== undefined ? normalizeStringArray(digestions) : undefined,
      skin,
      skins: skins !== undefined ? normalizeStringArray(skins) : undefined,
      discharge,
      exercise: exercise !== undefined ? normalizeStringArray(exercise) : undefined,
    },
    [
      'date',
      'flow',
      'mood',
      'moods',
      'energy',
      'symptoms',
      'note',
      'isIntimate',
      'cycleDay',
      'phase',
      'rewardPoints',
      'sleepHours',
      'waterIntake',
      'weight',
      'temperature',
      'stressLevel',
      'medication',
      'digestion',
      'digestions',
      'skin',
      'skins',
      'discharge',
      'exercise',
    ],
  );

  const cycleLog = await CycleLog.findOneAndUpdate({ userId, dateKey }, update, {
    new: true,
    upsert: true,
    runValidators: true,
  });

  // Update user token count and tracking streak.
  const userUpdates = {};
  if (isNewLog) {
    userUpdates.$inc = { walletBalance: tokensEarned };
  }
  // The streak only walks back *consecutive* days from today, so it never needs
  // more than a bounded recent window — and it only reads `dateKey`. Fetching
  // every full log document on every save grew unbounded with a user's history
  // on the hot write path; scope to dateKeys within the last ~2 years and pull
  // just that field as lean objects.
  const streakWindowStart = new Date();
  streakWindowStart.setDate(streakWindowStart.getDate() - 730);
  const recentLogs = await CycleLog.find({
    userId,
    dateKey: { $gte: streakWindowStart.toISOString().slice(0, 10) },
  })
    .select('dateKey')
    .lean();
  const currentStreak = calculateTrackingStreak(recentLogs, clientTodayKey);
  userUpdates.$set = { streakCount: currentStreak };

  await User.findByIdAndUpdate(userId, userUpdates);

  const updatedUser = await User.findById(userId).select('firstName lastName');
  const name = updatedUser ? `${updatedUser.firstName}` : 'Your partner';
  await createPartnerNotification(
    userId,
    'partner_message',
    'Cycle Log Updated 📝',
    `${name} updated their cycle log for ${dateKey}.`,
  );

  logger.info('cycle_log_saved', {
    action: 'cycle_log_saved',
    userId,
    dateKey,
    flow,
    phase,
    isNewLog,
    tokensEarned,
  });

  return { cycleLog, tokensEarned, isNewLog, phase };
};

/** POST /api/cycle/log — Upsert a day's cycle log */
export const saveCycleLog = async (req, res, next) => {
  try {
    const { cycleLog, tokensEarned } = await upsertCycleLog(req.userId, req.body);

    return sendResponse(res, HTTP_STATUS.OK, 'Cycle log saved successfully', {
      cycleLog,
      tokensEarned,
    });
  } catch (error) {
    if (error.status) {
      return sendError(res, error.status, error.message);
    }
    logger.error('cycle_log_save_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** GET /api/cycle/logs?month=2026-06 — All logs for a month */
export const getMonthLogs = async (req, res, next) => {
  try {
    const { month } = req.query; // 'YYYY-MM'

    const filter = { userId: req.userId };
    if (month) {
      if (!validateMonthKey(month)) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'month must be in YYYY-MM format');
      }
      filter.dateKey = { $regex: `^${month}` };
    }

    const logs = await CycleLog.find(filter).sort({ dateKey: 1 });

    logger.info('cycle_logs_fetched', {
      action: 'cycle_logs_fetched',
      userId: req.userId,
      month,
      count: logs.length,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Logs fetched', logs);
  } catch (error) {
    logger.error('cycle_logs_fetch_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** GET /api/cycle/log/:dateKey — Single day log */
export const getDayLog = async (req, res, next) => {
  try {
    const { dateKey } = req.params;
    if (!validateDateKey(dateKey)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'dateKey must be in YYYY-MM-DD format');
    }

    const log = await CycleLog.findOne({ userId: req.userId, dateKey });

    return sendResponse(res, HTTP_STATUS.OK, 'Day log fetched', log || null);
  } catch (error) {
    next(error);
  }
};

/** GET /api/cycle/settings — Get user cycle settings */
export const getCycleSettings = async (req, res, next) => {
  try {
    const settings = await CycleSettings.findOne({ userId: req.userId });
    return sendResponse(res, HTTP_STATUS.OK, 'Cycle settings', settings);
  } catch (error) {
    next(error);
  }
};

/** POST /api/cycle/settings — Create/update cycle settings + compute predictions */
export const saveCycleSettings = async (req, res, next) => {
  try {
    const {
      lastPeriodStartDate,
      cycleLength,
      periodLength,
      remindersEnabled,
      reminderDaysBefore,
      ovulationReminder,
      fertilityReminder,
      pregnancyMode,
      trackingGoal,
      trackingGoals,
    } = req.body;

    if (!lastPeriodStartDate) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'lastPeriodStartDate is required');
    }
    if (cycleLength !== undefined && (Number(cycleLength) < 20 || Number(cycleLength) > 45)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'cycleLength must be between 20 and 45 days');
    }
    if (periodLength !== undefined && (Number(periodLength) < 1 || Number(periodLength) > 10)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'periodLength must be between 1 and 10 days');
    }
    if (
      reminderDaysBefore !== undefined &&
      (Number(reminderDaysBefore) < 0 || Number(reminderDaysBefore) > 10)
    ) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'reminderDaysBefore must be between 0 and 10');
    }

    const updates = pickDefined(
      {
        lastPeriodStartDate,
        cycleLength,
        periodLength,
        remindersEnabled,
        reminderDaysBefore,
        ovulationReminder,
        fertilityReminder,
        pregnancyMode,
        trackingGoal,
        trackingGoals:
          trackingGoals !== undefined ? normalizeStringArray(trackingGoals) : undefined,
      },
      [
        'lastPeriodStartDate',
        'cycleLength',
        'periodLength',
        'remindersEnabled',
        'reminderDaysBefore',
        'ovulationReminder',
        'fertilityReminder',
        'pregnancyMode',
        'trackingGoal',
        'trackingGoals',
      ],
    );

    const settings = await CycleSettings.findOneAndUpdate({ userId: req.userId }, updates, {
      new: true,
      upsert: true,
      runValidators: true,
    });

    const updatedUser = await User.findById(req.userId).select('firstName lastName');
    const name = updatedUser ? `${updatedUser.firstName}` : 'Your partner';
    await createPartnerNotification(
      req.userId,
      'system',
      'Cycle Settings Updated ⚙️',
      `${name} updated their cycle parameters.`,
    );

    logger.info('cycle_settings_saved', {
      action: 'cycle_settings_saved',
      userId: req.userId,
      cycleLength,
      periodLength,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Cycle settings saved', settings);
  } catch (error) {
    logger.error('cycle_settings_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** GET /api/cycle/predictions — Computed predictions from settings */
export const getPredictions = async (req, res, next) => {
  try {
    const settings = await CycleSettings.findOne({ userId: req.userId });

    if (!settings) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Please set up your cycle settings first');
    }

    const logs = await CycleLog.find({ userId: req.userId }).sort({ dateKey: 1 });
    // Pass the full log history so the prediction is anchored on the user's
    // actual logged periods (and their real cycle-length variability), not a
    // fixed configured cycle length.
    const predictions = computeCyclePredictions(settings, logs);
    const analyticsData = buildCycleAnalytics(logs, settings).map((item) => ({
      month: new Date(`${item.month}-01T00:00:00.000Z`).toLocaleDateString('en-US', {
        month: 'short',
      }),
      length: item.estimatedCycleLength || settings.cycleLength,
      daysLogged: item.daysLogged,
      periodDays: item.periodDays,
      symptoms: item.symptoms,
    }));

    logger.info('predictions_fetched', { action: 'predictions_fetched', userId: req.userId });

    return sendResponse(res, HTTP_STATUS.OK, 'Predictions computed', {
      ...predictions,
      analyticsData,
    });
  } catch (error) {
    logger.error('predictions_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** GET /api/cycle/stats — Aggregated user cycle statistics */
export const getCycleStats = async (req, res, next) => {
  try {
    const logs = await CycleLog.find({ userId: req.userId });

    const totalDaysLogged = logs.length;
    const totalTokens = logs.reduce((sum, l) => sum + (l.rewardPoints || l.tokensEarned || 0), 0);

    const symptomFreq = {};
    logs.forEach((log) => {
      (log.symptoms || []).forEach((s) => {
        symptomFreq[s] = (symptomFreq[s] || 0) + 1;
      });
    });

    const topSymptoms = Object.entries(symptomFreq)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([symptom, count]) => ({ symptom, count }));

    const periodDays = logs.filter((log) => log.flow && log.flow !== 'none').length;
    const analyticsData = buildCycleAnalytics(logs);

    return sendResponse(res, HTTP_STATUS.OK, 'Cycle stats', {
      totalDaysLogged,
      totalTokens,
      periodDays,
      topSymptoms,
      analyticsData,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * GET /api/cycle/symptom-predictions — Deterministic, history-based likelihood
 * of each previously-logged symptom recurring in a given cycle phase.
 *
 * No AI/ML — purely a frequency count of (symptom, phase) occurrences across
 * the user's own past cycles, bucketed with the same phase math used by
 * saveCycleLog/getPredictions (utils/cycle.js).
 */
export const getSymptomPredictions = async (req, res, next) => {
  try {
    const settings = await CycleSettings.findOne({ userId: req.userId });

    if (!settings) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Please set up your cycle settings first');
    }

    const cycleLength = settings.cycleLength || 28;
    const periodLength = settings.periodLength || 5;
    const nextCycleStart = computeCyclePredictions(settings).nextPeriodDateKey;

    const logs = await CycleLog.find({
      userId: req.userId,
      symptoms: { $exists: true, $ne: [] },
    }).sort({ dateKey: 1 });

    // Bucket every symptom occurrence by (symptom, phase), and track which
    // distinct historical cycle (index relative to lastPeriodStartDate) each
    // occurrence belongs to, so repeat logs within the same cycle only count once.
    const bucketKey = (symptom, phase) => `${symptom}::${phase}`;
    const occurrenceCycles = new Map(); // bucketKey -> Set(cycleIndex)
    const allCycleIndexes = new Set();

    logs.forEach((log) => {
      const offset = diffDays(log.date, settings.lastPeriodStartDate);
      const cycleIndex = Math.floor(offset / cycleLength);
      const cycleDay = (((offset % cycleLength) + cycleLength) % cycleLength) + 1;
      const phase = getCyclePhase(cycleDay, periodLength, cycleLength);

      allCycleIndexes.add(cycleIndex);

      (log.symptoms || []).forEach((symptom) => {
        const key = bucketKey(symptom, phase);
        if (!occurrenceCycles.has(key)) occurrenceCycles.set(key, new Set());
        occurrenceCycles.get(key).add(cycleIndex);
      });
    });

    const cyclesAnalyzed = allCycleIndexes.size;

    if (cyclesAnalyzed < 2) {
      logger.info('symptom_predictions_insufficient_data', {
        action: 'symptom_predictions_insufficient_data',
        userId: req.userId,
        cyclesAnalyzed,
      });
      return sendResponse(
        res,
        HTTP_STATUS.OK,
        'Log at least 2 cycles to unlock symptom predictions',
        { nextCycleStart, predictions: [] },
      );
    }

    const predictions = [...occurrenceCycles.entries()]
      .map(([key, cycleSet]) => {
        const [symptom, phase] = key.split('::');
        const occurrences = cycleSet.size;
        return {
          symptom,
          phase,
          likelihood: Math.round((occurrences / cyclesAnalyzed) * 100),
          occurrences,
          cyclesAnalyzed,
        };
      })
      .filter((prediction) => prediction.occurrences >= 2)
      .sort((a, b) => b.likelihood - a.likelihood);

    logger.info('symptom_predictions_fetched', {
      action: 'symptom_predictions_fetched',
      userId: req.userId,
      cyclesAnalyzed,
      predictionCount: predictions.length,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Symptom predictions computed', {
      nextCycleStart,
      predictions,
    });
  } catch (error) {
    logger.error('symptom_predictions_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
