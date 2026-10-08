import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { createPartnerNotification } from './partnerController.js';
import {
  dateFromDateKey,
  normalizeBoolean,
  normalizeStringArray,
  pickDefined,
  validateDateKey,
  validateMonthKey,
  clientToday,
} from '../utils/apiHelpers.js';
import {
  buildCycleAnalytics,
  calculateTrackingStreak,
  computeCyclePredictions,
} from '../utils/cycle.js';

/* ──────────────────────────────────────────────
   Controllers
────────────────────────────────────────────── */

// The Samvaad voice agent sends "not_discussed" (a string) for any topic the
// caller skipped, rather than omitting the field, and sends its numeric
// fields (sleepHours/waterIntake/weight/temperature/stressLevel) as strings.
// Strip the placeholder and coerce numerics here so a skipped topic never
// hits Mongoose as an invalid enum value / cast target and fails the whole
// day's log.
const NOT_DISCUSSED = 'not_discussed';

const sanitizeEnumField = (value) =>
  typeof value === 'string' && value.trim().toLowerCase() === NOT_DISCUSSED ? undefined : value;

// Fields a full-day save (`replace: true`) unsets when it leaves them out.
// symptoms/isIntimate aren't here: the upsert always writes them.
const CLEARABLE_LOG_FIELDS = [
  'flow',
  'mood',
  'moods',
  'energy',
  'note',
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
];

const sanitizeNumberField = (value) => {
  const stripped = sanitizeEnumField(value);
  if (stripped === undefined || stripped === null || stripped === '') return undefined;
  const num = Number(stripped);
  return Number.isFinite(num) ? num : undefined;
};

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
    replace,
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

  // No logging ahead of today. Without the client's offset, allow a day of
  // slack past UTC so a user east of UTC can still log their local today.
  const latestAllowedKey = Number.isFinite(tzOffset)
    ? clientTodayKey
    : new Date(Date.now() + 24 * 60 * 60000).toISOString().slice(0, 10);
  if (dateKey > latestAllowedKey) {
    throw Object.assign(new Error("Future days can't be logged yet"), {
      status: HTTP_STATUS.BAD_REQUEST,
    });
  }

  const date = dateFromDateKey(dateKey);
  const settings = await CycleSettings.findOne({ userId });

  // The streak calc further down needs its own bounded-window log fetch
  // (see its comment below); pulled up here and reused for cycleDay/phase
  // too, so this stays one query instead of two.
  const streakWindowStart = new Date();
  streakWindowStart.setDate(streakWindowStart.getDate() - 730);
  const recentLogs = await CycleLog.find({
    userId,
    dateKey: { $gte: streakWindowStart.toISOString().slice(0, 10) },
  })
    .select('dateKey flow date')
    .lean();

  // cycleDay/phase are derived through the same episode-based anchor
  // getPredictions/insights/partner-view use (computeCyclePredictions,
  // anchored at this log's own date via `options.today`), instead of a raw
  // offset from the user-configured, only-user-edited
  // CycleSettings.lastPeriodStartDate — which drifts out of sync from a
  // user's real logged periods over time (see docs/fixes.md 1.4: insightController
  // and partnerController already had to make this same switch).
  const predictionsAtDate = settings
    ? computeCyclePredictions(settings, recentLogs, { today: date })
    : null;
  const normalizedCycleDay = predictionsAtDate?.currentCycleDay;
  const phase = predictionsAtDate?.currentPhase;

  const isNewLog = !(await CycleLog.findOne({ userId, dateKey }));
  const tokensEarned = isNewLog ? 5 : 1;
  const update = pickDefined(
    {
      date,
      flow: sanitizeEnumField(flow),
      mood: sanitizeEnumField(mood),
      moods: moods !== undefined ? normalizeStringArray(moods) : undefined,
      energy: sanitizeEnumField(energy),
      symptoms: normalizeStringArray(symptoms),
      note: note?.trim(),
      isIntimate:
        typeof isIntimate === 'boolean'
          ? isIntimate
          : sanitizeEnumField(isIntimate) !== undefined
            ? normalizeBoolean(isIntimate)
            : undefined,
      cycleDay: normalizedCycleDay,
      phase,
      rewardPoints: tokensEarned,
      sleepHours: sanitizeNumberField(sleepHours),
      waterIntake: sanitizeNumberField(waterIntake),
      weight: sanitizeNumberField(weight),
      temperature: sanitizeNumberField(temperature),
      stressLevel: sanitizeNumberField(stressLevel),
      medication: medication !== undefined ? normalizeStringArray(medication) : undefined,
      digestion: sanitizeEnumField(digestion),
      digestions: digestions !== undefined ? normalizeStringArray(digestions) : undefined,
      skin: sanitizeEnumField(skin),
      skins: skins !== undefined ? normalizeStringArray(skins) : undefined,
      discharge: sanitizeEnumField(discharge),
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

  // `replace: true` (the app's full "Save Log") means the payload is the whole
  // day: any field it leaves out was cleared by the user and must be unset,
  // otherwise the merge above would keep the old value (e.g. a flow picked by
  // mistake). Partial writers — Quick Log, the voice agent, the check-in
  // backfill — omit `replace` and keep merge semantics.
  if (replace === true) {
    const unset = {};
    CLEARABLE_LOG_FIELDS.forEach((field) => {
      if (update[field] === undefined) unset[field] = 1;
    });
    if (Object.keys(unset).length > 0) update.$unset = unset;
  }

  // `wasNewlyCreated` is derived from the upsert's own result
  // (`updatedExisting`), not the earlier `isNewLog` pre-read — two
  // concurrent requests for the same (userId, dateKey) both used to read
  // "no log yet" before either write landed, so both credited the "new log"
  // bonus even though CycleLog's unique (userId, dateKey) constraint made
  // the upsert itself land as one document. The wallet `$inc` below is
  // gated on this atomic result; `rewardPoints` stored on the document
  // itself is cosmetic (per-request display value) and unaffected.
  let result;
  try {
    result = await CycleLog.findOneAndUpdate({ userId, dateKey }, update, {
      new: true,
      upsert: true,
      runValidators: true,
      includeResultMetadata: true,
    });
  } catch (error) {
    // `runValidators` validates the whole merged update in one atomic op —
    // one out-of-range field (e.g. a garbled voice-logged temperature/
    // stressLevel) would otherwise discard the *entire* day's log, including
    // every other valid field in the same request. Drop just the field(s)
    // Mongoose flagged and retry once, rather than losing the whole update.
    if (error?.name === 'ValidationError' && error.errors) {
      const invalidPaths = Object.keys(error.errors);
      const retryUpdate = { ...update };
      invalidPaths.forEach((path) => delete retryUpdate[path]);
      logger.warn('cycle_log_field_dropped', {
        action: 'cycle_log_field_dropped',
        userId,
        dateKey,
        invalidPaths,
      });
      result = await CycleLog.findOneAndUpdate({ userId, dateKey }, retryUpdate, {
        new: true,
        upsert: true,
        runValidators: true,
        includeResultMetadata: true,
      });
    } else {
      throw error;
    }
  }
  const cycleLog = result.value;
  const wasNewlyCreated = !result.lastErrorObject?.updatedExisting;

  // Update user token count and tracking streak. Wallet credit only ever
  // applies to the request that actually created the log (matches the
  // pre-existing behavior of only rewarding brand-new logs, not edits to an
  // existing day) — just gated on the atomic result instead of the earlier
  // pre-read, so two concurrent requests for the same new day can't both
  // credit the "new log" bonus.
  const userUpdates = {};
  if (wasNewlyCreated) {
    userUpdates.$inc = { walletBalance: 5 };
  }
  // The streak only walks back *consecutive* days from today, so it never needs
  // more than a bounded recent window — and it only reads `dateKey`. Re-fetched
  // here (rather than reusing the pre-write `recentLogs` above) since it must
  // reflect the log just written above, and pulls just that field as lean
  // objects to stay cheap on this hot write path.
  const postWriteStreakWindowStart = new Date();
  postWriteStreakWindowStart.setDate(postWriteStreakWindowStart.getDate() - 730);
  const postWriteRecentLogs = await CycleLog.find({
    userId,
    dateKey: { $gte: postWriteStreakWindowStart.toISOString().slice(0, 10) },
  })
    .select('dateKey')
    .lean();
  const currentStreak = calculateTrackingStreak(postWriteRecentLogs, clientTodayKey);
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

  // Report the atomic result to the caller/logs, not the pre-read guess —
  // a request that thought it was creating the log but lost the race
  // actually only earned the smaller "update" bonus.
  const reportedTokensEarned = wasNewlyCreated ? 5 : 1;

  logger.info('cycle_log_saved', {
    action: 'cycle_log_saved',
    userId,
    dateKey,
    flow,
    phase,
    isNewLog: wasNewlyCreated,
    tokensEarned: reportedTokensEarned,
  });

  return { cycleLog, tokensEarned: reportedTokensEarned, isNewLog: wasNewlyCreated, phase };
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

/**
 * DELETE /api/cycle/log/:dateKey — Remove a day's log entirely
 *
 * Lets a user undo a log made on the wrong date. The upsert above skips
 * undefined fields, so re-saving a day with everything deselected can't
 * clear it (a stray `flow` would keep counting as a period day in
 * predictions) — the whole document has to go. The "new log" wallet credit
 * (+5, see upsertCycleLog) is taken back, floored at zero, so deleting and
 * re-logging the same day can't farm tokens.
 */
export const deleteCycleLog = async (req, res, next) => {
  try {
    const { dateKey } = req.params;
    if (!validateDateKey(dateKey)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'dateKey must be in YYYY-MM-DD format');
    }

    const deleted = await CycleLog.findOneAndDelete({ userId: req.userId, dateKey });
    if (!deleted) {
      return sendResponse(res, HTTP_STATUS.OK, 'No log for this day', { deleted: false });
    }

    const tzOffset = Number(req.query.timezoneOffsetMinutes);
    const clientTodayKey = Number.isFinite(tzOffset)
      ? new Date(Date.now() - tzOffset * 60000).toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
    const streakWindowStart = new Date();
    streakWindowStart.setDate(streakWindowStart.getDate() - 730);
    const recentLogs = await CycleLog.find({
      userId: req.userId,
      dateKey: { $gte: streakWindowStart.toISOString().slice(0, 10) },
    })
      .select('dateKey')
      .lean();
    const currentStreak = calculateTrackingStreak(recentLogs, clientTodayKey);

    await User.findByIdAndUpdate(req.userId, [
      {
        $set: {
          streakCount: currentStreak,
          walletBalance: { $max: [0, { $subtract: [{ $ifNull: ['$walletBalance', 0] }, 5] }] },
        },
      },
    ]);

    logger.info('cycle_log_deleted', {
      action: 'cycle_log_deleted',
      userId: req.userId,
      dateKey,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Cycle log deleted', { deleted: true });
  } catch (error) {
    logger.error('cycle_log_delete_error', { userId: req.userId, error: error.message });
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
    const predictions = computeCyclePredictions(settings, logs, { today: clientToday(req) });
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

    // All logs (not just symptom ones) are needed so computeCyclePredictions
    // can derive real period episodes for the anchor below — narrowing the
    // query to `symptoms`-bearing logs only would silently exclude period-
    // flow logs from episode detection, corrupting the very anchor this fix
    // exists to use.
    const allLogs = await CycleLog.find({ userId: req.userId }).sort({ dateKey: 1 });
    const nextCycleStart = computeCyclePredictions(settings, allLogs, {
      today: clientToday(req),
    }).nextPeriodDateKey;

    const logs = allLogs.filter((log) => log.symptoms && log.symptoms.length > 0);

    // Bucket every symptom occurrence by (symptom, phase), and track which
    // distinct historical cycle each occurrence belongs to (keyed by that
    // cycle's actual period-start date, from the same episode-based anchor
    // getPredictions/insights use — not a raw offset from the
    // user-configured lastPeriodStartDate, which drifts out of sync from
    // real logged periods over time — see docs/fixes.md 1.4) so repeat logs
    // within the same cycle only count once.
    const bucketKey = (symptom, phase) => `${symptom}::${phase}`;
    const occurrenceCycles = new Map(); // bucketKey -> Set(cycleIndex)
    const allCycleIndexes = new Set();

    logs.forEach((log) => {
      const { currentPeriodStartDateISO, currentPhase } = computeCyclePredictions(
        settings,
        allLogs,
        { today: log.date },
      );
      const cycleIndex = currentPeriodStartDateISO;
      const phase = currentPhase;

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
