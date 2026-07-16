import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import {
  dateFromDateKey,
  isValidObjectId,
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

/** POST /api/cycle/log — Upsert a day's cycle log */
export const saveCycleLog = async (req, res, next) => {
  try {
    const {
      dateKey,
      flow,
      mood,
      energy,
      symptoms,
      note,
      sleepHours,
      waterIntake,
      weight,
      temperature,
      stressLevel,
      medication
    } = req.body;

    if (!dateKey || !validateDateKey(dateKey)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'dateKey is required (YYYY-MM-DD)');
    }

    const date = dateFromDateKey(dateKey);
    const settings = await CycleSettings.findOne({ userId: req.userId });
    // Offset (in days) from the tracked cycle start; can be negative for dates
    // logged before lastPeriodStartDate (e.g. backfilled history).
    const cycleLength = settings?.cycleLength || 28;
    const offset = settings ? diffDays(date, settings.lastPeriodStartDate) : undefined;
    // Wrap with a true modulo (not JS's remainder, which keeps the sign of the
    // dividend) so dates before the tracked start land on the correct day of the
    // *previous* cycle instead of all collapsing onto cycleDay 1 / "period".
    const normalizedCycleDay = offset !== undefined
      ? (((offset % cycleLength) + cycleLength) % cycleLength) + 1
      : undefined;
    const phase = normalizedCycleDay
      ? getCyclePhase(normalizedCycleDay, settings?.periodLength || 5, cycleLength)
      : undefined;

    const isNewLog = !(await CycleLog.findOne({ userId: req.userId, dateKey }));
    const tokensEarned = isNewLog ? 5 : 1;
    const update = pickDefined(
      {
        date,
        flow,
        mood,
        energy,
        symptoms: normalizeStringArray(symptoms),
        note: note?.trim(),
        cycleDay: normalizedCycleDay,
        phase,
        rewardPoints: tokensEarned,
        sleepHours,
        waterIntake,
        weight,
        temperature,
        stressLevel,
        medication: medication !== undefined ? normalizeStringArray(medication) : undefined,
      },
      [
        'date', 'flow', 'mood', 'energy', 'symptoms', 'note', 'cycleDay', 'phase',
        'rewardPoints', 'sleepHours', 'waterIntake', 'weight',
        'temperature', 'stressLevel', 'medication'
      ]
    );

    const cycleLog = await CycleLog.findOneAndUpdate(
      { userId: req.userId, dateKey },
      update,
      { new: true, upsert: true, runValidators: true }
    );

    // Update user token count and tracking streak
    const userUpdates = {};
    if (isNewLog) {
      userUpdates.$inc = { walletBalance: tokensEarned };
    }
    const allUserLogs = await CycleLog.find({ userId: req.userId });
    const currentStreak = calculateTrackingStreak(allUserLogs);
    userUpdates.$set = { streakCount: currentStreak };

    await User.findByIdAndUpdate(req.userId, userUpdates);

    logger.info('cycle_log_saved', {
      action: 'cycle_log_saved',
      userId: req.userId,
      dateKey,
      flow,
      phase,
      isNewLog,
      tokensEarned,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Cycle log saved successfully', { cycleLog, tokensEarned });
  } catch (error) {
    logger.error('cycle_log_save_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** GET /api/cycle/logs?month=2026-06 — All logs for a month */
export const getMonthLogs = async (req, res, next) => {
  try {
    const { month } = req.query; // 'YYYY-MM'

    let filter = { userId: req.userId };
    if (month) {
      if (!validateMonthKey(month)) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'month must be in YYYY-MM format');
      }
      filter.dateKey = { $regex: `^${month}` };
    }

    const logs = await CycleLog.find(filter).sort({ dateKey: 1 });

    logger.info('cycle_logs_fetched', { action: 'cycle_logs_fetched', userId: req.userId, month, count: logs.length });

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
      trackingGoal
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
    if (reminderDaysBefore !== undefined && (Number(reminderDaysBefore) < 0 || Number(reminderDaysBefore) > 14)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'reminderDaysBefore must be between 0 and 14');
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
        trackingGoal
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
        'trackingGoal'
      ]
    );

    const settings = await CycleSettings.findOneAndUpdate(
      { userId: req.userId },
      updates,
      { new: true, upsert: true, runValidators: true }
    );

    logger.info('cycle_settings_saved', { action: 'cycle_settings_saved', userId: req.userId, cycleLength, periodLength });

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

    const predictions = computeCyclePredictions(settings);
    const logs = await CycleLog.find({ userId: req.userId }).sort({ dateKey: 1 });
    const analyticsData = buildCycleAnalytics(logs, settings).map((item) => ({
      month: new Date(`${item.month}-01T00:00:00.000Z`).toLocaleDateString('en-US', { month: 'short' }),
      length: item.estimatedCycleLength || settings.cycleLength,
      daysLogged: item.daysLogged,
      periodDays: item.periodDays,
      symptoms: item.symptoms,
    }));

    logger.info('predictions_fetched', { action: 'predictions_fetched', userId: req.userId });

    return sendResponse(res, HTTP_STATUS.OK, 'Predictions computed', { ...predictions, analyticsData });
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
    logs.forEach(log => {
      (log.symptoms || []).forEach(s => {
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
