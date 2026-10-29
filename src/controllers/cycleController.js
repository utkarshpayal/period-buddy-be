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
  clientTodayKey as requestTodayKey,
} from '../utils/apiHelpers.js';
import {
  buildCycleAnalytics,
  calculateTrackingStreak,
  computeCyclePredictions,
  cycleForDate,
  predictCycleFromHistory,
  prepareCycleHistory,
} from '../utils/cycle.js';
import { loadPredictionLogs } from '../utils/predictionLogs.js';
import { computeAgeFromDob } from '../utils/companionChat.js';
import {
  IMPORT_SOURCES,
  MAX_IMPORT_DAYS,
  mergeImportedLog,
  prepareImport,
} from '../utils/cycleImport.js';

// Finished cycles needed before a symptom pattern is shown.
const MIN_SYMPTOM_CYCLES = 3;

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

/**
 * POST /api/cycle/import — Day logs from another period app (Clue, Flo)
 *
 * The app reads the other app's export and sends plain day logs. New days
 * are inserted; a day already logged in Nura only gets the fields it's
 * missing (utils/cycleImport.js#mergeImportedLog), so nothing the person
 * logged here is overwritten. Unlike POST /log, an import earns no reward
 * points and sends no partner notification: it's history, not a new log.
 * cycleDay/phase are left unset; everything that shows them derives them
 * from the logs. Safe to repeat: a second import of the same file changes
 * nothing.
 */
export const importCycleLogs = async (req, res, next) => {
  try {
    const { source, logs } = req.body ?? {};
    if (!IMPORT_SOURCES.includes(source)) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        `source must be one of: ${IMPORT_SOURCES.join(', ')}`,
      );
    }
    if (!Array.isArray(logs) || logs.length === 0) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'logs must be a non-empty array');
    }
    if (logs.length > MAX_IMPORT_DAYS) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        `At most ${MAX_IMPORT_DAYS} days can be imported at once`,
      );
    }

    const todayKey = requestTodayKey(req);
    const { logs: cleaned, invalid } = prepareImport(logs, todayKey);

    const existing = await CycleLog.find({
      userId: req.userId,
      dateKey: { $in: cleaned.map((log) => log.dateKey) },
    })
      .select(
        'dateKey flow mood moods energy symptoms isIntimate sleepHours weight temperature medication digestion digestions skin skins discharge exercise',
      )
      .lean();
    const existingByDate = new Map(existing.map((log) => [log.dateKey, log]));

    const inserts = [];
    const updates = [];
    let unchanged = 0;
    for (const log of cleaned) {
      const current = existingByDate.get(log.dateKey);
      if (!current) {
        inserts.push({
          ...log,
          userId: req.userId,
          date: dateFromDateKey(log.dateKey),
          rewardPoints: 0,
        });
        continue;
      }
      const set = mergeImportedLog(current, log);
      if (!set) {
        unchanged += 1;
        continue;
      }
      updates.push({ updateOne: { filter: { _id: current._id }, update: { $set: set } } });
    }

    let added = 0;
    if (inserts.length) {
      try {
        added = (await CycleLog.insertMany(inserts, { ordered: false })).length;
      } catch (error) {
        // A day logged in the app while the import ran: keep that log, and
        // count everything else that went in.
        if (error?.code !== 11000 && error?.name !== 'MongoBulkWriteError') throw error;
        added = error.insertedDocs?.length ?? error.result?.insertedCount ?? 0;
        unchanged += inserts.length - added;
      }
    }
    if (updates.length) await CycleLog.bulkWrite(updates, { ordered: false });

    if (added > 0) {
      const streakWindowStart = new Date();
      streakWindowStart.setDate(streakWindowStart.getDate() - 730);
      const recentLogs = await CycleLog.find({
        userId: req.userId,
        dateKey: { $gte: streakWindowStart.toISOString().slice(0, 10) },
      })
        .select('dateKey')
        .lean();
      await User.findByIdAndUpdate(req.userId, {
        $set: { streakCount: calculateTrackingStreak(recentLogs, todayKey) },
      });
    }

    const summary = {
      received: logs.length,
      added,
      updated: updates.length,
      unchanged,
      skipped: invalid,
    };
    logger.info('cycle_logs_imported', {
      action: 'cycle_logs_imported',
      userId: req.userId,
      source,
      ...summary,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Cycle history imported', summary);
  } catch (error) {
    logger.error('cycle_logs_import_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

const YEAR_KEY_REGEX = /^\d{4}$/;

/**
 * GET /api/cycle/logs?month=2026-06 | ?year=2026 — All logs for a month, or a
 * whole year in one request (`month` wins if both are sent).
 *
 * Not lean on purpose: hydrated docs fill schema defaults (moods: [],
 * note: '', flow: 'none', ...) for older logs that lack a field, and the app
 * reads them as present.
 */
export const getMonthLogs = async (req, res, next) => {
  try {
    const { month, year } = req.query; // 'YYYY-MM' / 'YYYY'

    const filter = { userId: req.userId };
    if (month) {
      if (!validateMonthKey(month)) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'month must be in YYYY-MM format');
      }
      filter.dateKey = { $regex: `^${month}` };
    } else if (year) {
      if (!YEAR_KEY_REGEX.test(String(year))) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'year must be in YYYY format');
      }
      filter.dateKey = { $regex: `^${year}-` };
    }

    const logs = await CycleLog.find(filter).sort({ dateKey: 1 });

    logger.info('cycle_logs_fetched', {
      action: 'cycle_logs_fetched',
      userId: req.userId,
      month,
      year: month ? undefined : year,
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

    // dateKey/flow for the prediction, symptoms for buildCycleAnalytics.
    const logs = await loadPredictionLogs(req.userId, { extraFields: 'symptoms' });
    // Pass the full log history so the prediction is anchored on the user's
    // actual logged periods (and their real cycle-length variability), not a
    // fixed configured cycle length.
    const predictions = computeCyclePredictions(settings, logs, {
      today: clientToday(req),
      age: computeAgeFromDob(req.user?.dateOfBirth),
    });
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
    // Only the fields the stats read. tokensEarned isn't a schema path, so it
    // was always undefined on the hydrated docs and stays so here.
    const logs = await CycleLog.find({ userId: req.userId })
      .select('dateKey flow symptoms rewardPoints')
      .lean();

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
    // Only the fields read below: dateKey/flow (predictions), date, symptoms.
    const allLogs = await loadPredictionLogs(req.userId, { extraFields: 'date symptoms' });
    // The episode/cycle-length analysis depends only on the history, so it is
    // built once instead of once per symptom log; predictCycleFromHistory
    // returns exactly what computeCyclePredictions(settings, allLogs, ...)
    // would (utils/__tests__/cyclePrediction.test.js checks this).
    const age = computeAgeFromDob(req.user?.dateOfBirth);
    const history = prepareCycleHistory(settings, allLogs, { age });
    const now = predictCycleFromHistory(settings, history, { today: clientToday(req) });
    const nextCycleStart = now.nextPeriodDateKey;
    // The cycle in progress isn't finished, so it can't say whether a symptom
    // "usually" shows up in its later phases: it's left out of the counts.
    const currentCycleKey = now.currentPeriodStartDateISO.slice(0, 10);

    // For each phase: the cycles where anything at all was logged in that
    // phase (the denominator: a cycle with no logs there says nothing), and
    // per symptom the cycles it was logged in. Keyed by cycle start, so
    // repeat logs within one cycle count once.
    const phaseCycles = new Map(); // phase -> Set(cycleKey)
    const occurrenceCycles = new Map(); // `${symptom}::${phase}` -> Set(cycleKey)
    const allCycleKeys = new Set();

    allLogs.forEach((log) => {
      const placed = cycleForDate(settings, history, log.dateKey);
      if (!placed || placed.cycleKey === currentCycleKey) return;
      const { cycleKey, phase } = placed;
      allCycleKeys.add(cycleKey);
      if (!phaseCycles.has(phase)) phaseCycles.set(phase, new Set());
      phaseCycles.get(phase).add(cycleKey);
      (log.symptoms || []).forEach((symptom) => {
        const key = `${symptom}::${phase}`;
        if (!occurrenceCycles.has(key)) occurrenceCycles.set(key, new Set());
        occurrenceCycles.get(key).add(cycleKey);
      });
    });

    const cyclesAnalyzed = allCycleKeys.size;

    // Below 3 finished cycles a pattern can't be told apart from chance
    // (2 of 2 would read as "every cycle").
    if (cyclesAnalyzed < MIN_SYMPTOM_CYCLES) {
      logger.info('symptom_predictions_insufficient_data', {
        action: 'symptom_predictions_insufficient_data',
        userId: req.userId,
        cyclesAnalyzed,
      });
      return sendResponse(
        res,
        HTTP_STATUS.OK,
        `Log at least ${MIN_SYMPTOM_CYCLES} cycles to unlock symptom predictions`,
        { nextCycleStart, predictions: [], cyclesAnalyzed },
      );
    }

    const predictions = [...occurrenceCycles.entries()]
      .map(([key, cycleSet]) => {
        const [symptom, phase] = key.split('::');
        const occurrences = cycleSet.size;
        const phaseTotal = phaseCycles.get(phase)?.size ?? 0;
        return {
          symptom,
          phase,
          likelihood: phaseTotal ? Math.round((occurrences / phaseTotal) * 100) : 0,
          occurrences,
          // Per phase: cycles with any log in this phase.
          cyclesAnalyzed: phaseTotal,
        };
      })
      .filter((p) => p.occurrences >= 2 && p.cyclesAnalyzed >= MIN_SYMPTOM_CYCLES)
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
      cyclesAnalyzed,
    });
  } catch (error) {
    logger.error('symptom_predictions_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
