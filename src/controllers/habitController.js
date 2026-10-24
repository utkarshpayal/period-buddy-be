import Habit from '../models/Habit.js';
import HabitCompletion from '../models/HabitCompletion.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import {
  HEX_COLOR_REGEX,
  clientToday,
  clientTodayKey,
  isValidObjectId,
} from '../utils/apiHelpers.js';
import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import HabitSuggestionDay from '../models/HabitSuggestionDay.js';
import { computeCyclePredictions } from '../utils/cycle.js';
import { loadPredictionLogs } from '../utils/predictionLogs.js';
import { shiftDateKey } from '../utils/forestGrowth.js';
import { aiAllowed } from '../utils/privacy.js';
import { getAgeBand } from '../utils/aiSafety.js';
import { generateHabitSuggestions } from '../utils/habitSuggestionsAi.js';
import {
  SUGGESTION_WINDOW_DAYS,
  dismissedTitles,
  hasRecentLogs,
  isSuggestionKey,
  shouldRetryAi,
  visibleSuggestions,
} from '../utils/habitSuggestions.js';
import { isAiConfigured } from '../utils/sarvamClient.js';
import { MAX_ACTIVE_HABITS, habitStreak, habitWeek } from '../utils/habitDays.js';

/** GET /api/habits — Get user's active habits with today's completion status */
export const getHabits = async (req, res, next) => {
  try {
    // No fixed starter habits: a new person picks from suggestions made from
    // their own logs (GET /api/habits/suggestions).
    const habits = await Habit.find({ userId: req.userId, isActive: true }).sort({ createdAt: 1 });

    // The phone's local day (X-Timezone-Offset), the same day Forest and the
    // day logs use, so a 1 am tick in India counts for today, not UTC's.
    const todayKey = clientTodayKey(req);
    const result = habits.map((h) => ({
      id: h._id,
      title: h.title,
      icon: h.icon,
      color: h.color,
      tokens: h.rewardPoints || 30,
      rewardPoints: h.rewardPoints || 30,
      // Recompute from completedDates rather than trusting the persisted
      // `streak` field, which is only updated on toggle — without this,
      // a habit missed for several days without being toggled would keep
      // showing its old streak instead of resetting to 0.
      streak: habitStreak(h.completedDates, todayKey),
      week: habitWeek(h.completedDates, todayKey),
      reason: h.reason || undefined,
      completed: h.completedDates.includes(todayKey),
    }));

    return sendResponse(res, HTTP_STATUS.OK, 'Habits fetched', result);
  } catch (error) {
    logger.error('habits_fetch_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/** POST /api/habits — Add a new habit */
export const createHabit = async (req, res, next) => {
  try {
    const { title, icon, color, frequency, target, reminderTime } = req.body;
    const rewardPoints =
      req.body.rewardPoints !== undefined
        ? Number(req.body.rewardPoints)
        : req.body.tokens !== undefined
          ? Number(req.body.tokens)
          : 30;

    if (!title?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Habit title is required');
    }
    if (title.trim().length > 100) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Habit title must be 100 characters or fewer');
    }
    if (!Number.isInteger(rewardPoints) || rewardPoints < 1 || rewardPoints > 200) {
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        'rewardPoints must be an integer between 1 and 200',
      );
    }
    if (color && !HEX_COLOR_REGEX.test(color)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'color must be a valid hex color');
    }
    const activeCount = await Habit.countDocuments({ userId: req.userId, isActive: true });
    if (activeCount >= MAX_ACTIVE_HABITS) {
      return sendError(
        res,
        HTTP_STATUS.CONFLICT,
        `You can have up to ${MAX_ACTIVE_HABITS} habits. Remove one to add another.`,
      );
    }

    const habit = await Habit.create({
      userId: req.userId,
      title: title.trim(),
      icon,
      color,
      rewardPoints,
      frequency: frequency || 'daily',
      target: target !== undefined ? Number(target) : 1,
      reminderTime: reminderTime?.trim(),
      reason:
        typeof req.body.reason === 'string' && req.body.reason.trim()
          ? req.body.reason.trim().slice(0, 120)
          : undefined,
    });

    logger.info('habit_created', {
      action: 'habit_created',
      userId: req.userId,
      habitId: habit._id,
      title,
      // Which suggestion it came from, to see how often AI vs rule picks are taken.
      suggestionKey:
        typeof req.body.suggestionKey === 'string'
          ? req.body.suggestionKey.slice(0, 60)
          : undefined,
      suggestionSource: ['ai', 'rules'].includes(req.body.suggestionSource)
        ? req.body.suggestionSource
        : undefined,
    });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Habit created', {
      id: habit._id,
      title: habit.title,
      icon: habit.icon,
      color: habit.color,
      tokens: habit.rewardPoints,
      rewardPoints: habit.rewardPoints,
      frequency: habit.frequency,
      target: habit.target,
      reminderTime: habit.reminderTime,
      reason: habit.reason || undefined,
      streak: 0,
      week: habitWeek([], clientTodayKey(req)),
      completed: false,
    });
  } catch (error) {
    next(error);
  }
};

/** PATCH /api/habits/:id/toggle — Toggle habit completion for today */
export const toggleHabit = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid habit id');
    }

    // A deleted (soft-deleted) habit can't be completed or earn tokens.
    const habit = await Habit.findOne({ _id: req.params.id, userId: req.userId, isActive: true });
    if (!habit) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Habit not found');
    }

    const todayKey = clientTodayKey(req);
    const alreadyDone = habit.completedDates.includes(todayKey);

    let tokensAwarded = 0;
    if (alreadyDone) {
      // Uncomplete. The wallet decrement is gated on the *result* of the
      // delete, not the prior `alreadyDone` read — two concurrent toggles
      // both reading alreadyDone=true would otherwise both decrement, but
      // only the request whose delete actually removed the row (deletedCount
      // 1) gets to touch the wallet; the other's delete is a no-op (already
      // gone) and it skips the decrement entirely.
      const { deletedCount } = await HabitCompletion.deleteOne({
        habitId: habit._id,
        dateKey: todayKey,
      });
      if (deletedCount > 0) {
        habit.completedDates = habit.completedDates.filter((d) => d !== todayKey);
        habit.streak = habitStreak(habit.completedDates, todayKey);
        tokensAwarded = -(habit.rewardPoints || 30);
        const updatedUser = await User.findByIdAndUpdate(
          req.userId,
          { $inc: { walletBalance: tokensAwarded } },
          { new: true },
        );
        // Preserve the previous non-negative floor without reintroducing a
        // read-then-write race: clamp only if the atomic $inc pushed it
        // below 0, in a second, separately-atomic update.
        if (updatedUser && updatedUser.walletBalance < 0) {
          await User.updateOne({ _id: req.userId }, { $set: { walletBalance: 0 } });
        }
      }
    } else {
      // Complete. HabitCompletion's unique (habitId, dateKey) index is the
      // atomic gate: only the first of two concurrent "complete" requests
      // for the same day successfully creates the row and earns tokens — the
      // second hits E11000 and is treated as a no-op instead of also
      // crediting the wallet (the previous read-then-$inc pattern let both
      // through, since the completedDates.includes(todayKey) check above and
      // the wallet $inc were never part of the same atomic operation).
      try {
        await HabitCompletion.create({
          habitId: habit._id,
          userId: req.userId,
          dateKey: todayKey,
          rewardPoints: habit.rewardPoints || 30,
        });
      } catch (error) {
        if (error?.code === 11000) {
          return sendResponse(res, HTTP_STATUS.OK, 'Habit toggled', {
            id: habit._id,
            completed: true,
            streak: habit.streak,
            tokensAwarded: 0,
          });
        }
        throw error;
      }
      habit.completedDates.push(todayKey);
      habit.streak = habitStreak(habit.completedDates, todayKey);
      tokensAwarded = habit.rewardPoints || 30;
      await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: tokensAwarded } });
    }

    await habit.save();

    logger.info('habit_toggled', {
      action: 'habit_toggled',
      userId: req.userId,
      habitId: habit._id,
      completed: !alreadyDone,
      streak: habit.streak,
      tokensAwarded,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Habit toggled', {
      id: habit._id,
      completed: !alreadyDone,
      streak: habit.streak,
      tokensAwarded,
    });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/habits/:id — Soft-delete a habit */
export const deleteHabit = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid habit id');
    }

    const habit = await Habit.findOneAndUpdate(
      { _id: req.params.id, userId: req.userId },
      { isActive: false },
      { new: true },
    );
    if (!habit) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Habit not found');

    logger.info('habit_deleted', {
      action: 'habit_deleted',
      userId: req.userId,
      habitId: habit._id,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Habit removed');
  } catch (error) {
    next(error);
  }
};

const SUGGESTION_LOG_FIELDS =
  'dateKey flow mood moods energy symptoms sleepHours waterIntake stressLevel digestion digestions skin skins exercise';

// One generation per person and day at a time, so a double open doesn't pay
// for two AI calls. (Across servers, the unique index decides.)
const generating = new Map();
const once = (key, fn) => {
  let pending = generating.get(key);
  if (!pending) {
    pending = fn().finally(() => generating.delete(key));
    generating.set(key, pending);
  }
  return pending;
};

/** Everything the picks are made from: recent logs, phase, goal and what to avoid. */
const loadSuggestionInput = async (req, todayKey, existingTitles) => {
  const userId = req.userId;
  const since = shiftDateKey(todayKey, -(SUGGESTION_WINDOW_DAYS - 1));
  const removedSince = new Date(Date.now() - SUGGESTION_WINDOW_DAYS * 86_400_000);
  const [logs, settings, recentDays, removed] = await Promise.all([
    CycleLog.find({ userId, dateKey: { $gte: since, $lte: todayKey } })
      .select(SUGGESTION_LOG_FIELDS)
      .lean(),
    CycleSettings.findOne({ userId }).lean(),
    HabitSuggestionDay.find({ userId, dateKey: { $gte: since }, 'dismissed.0': { $exists: true } })
      .select('suggestions dismissed')
      .lean(),
    Habit.find({ userId, isActive: false, updatedAt: { $gte: removedSince } })
      .select('title')
      .lean(),
  ]);

  let phase = null;
  if (settings && !settings.pregnancyMode) {
    try {
      const history = await loadPredictionLogs(userId);
      phase = computeCyclePredictions(settings, history, { today: clientToday(req) }).currentPhase;
    } catch {
      // No phase: the suggestions just lean on the logs and goal.
    }
  }

  return {
    logs,
    todayKey,
    phase,
    goal: settings?.trackingGoal,
    pregnancyMode: Boolean(settings?.pregnancyMode),
    existingTitles,
    avoidTitles: [...new Set([...dismissedTitles(recentDays), ...removed.map((h) => h.title)])],
    ageBand: getAgeBand(req.user?.dateOfBirth),
    useAi: aiAllowed(req.user),
  };
};

const logGenerated = (userId, result, retry = false) =>
  logger.info('habit_suggestions_generated', {
    action: 'habit_suggestions_generated',
    userId,
    source: result.source,
    aiFailed: result.aiFailed,
    retry,
    count: result.suggestions.length,
  });

const createSuggestionDay = async (req, todayKey, existingTitles) => {
  const input = await loadSuggestionInput(req, todayKey, existingTitles);
  // Nothing logged in the window: store nothing, so the first open after she
  // logs makes real picks instead of serving an empty day.
  if (!hasRecentLogs(input.logs, todayKey))
    return { needsLogs: true, source: 'rules', suggestions: [] };
  const result = await generateHabitSuggestions(input);
  logGenerated(req.userId, result);
  try {
    const day = await HabitSuggestionDay.create({
      userId: req.userId,
      dateKey: todayKey,
      source: result.source,
      suggestions: result.suggestions,
      context: { phase: input.phase, goal: input.goal },
      aiFailed: result.aiFailed,
    });
    return day.toObject();
  } catch (error) {
    // Another server made today's first: serve that one.
    if (error?.code !== 11000) throw error;
    return HabitSuggestionDay.findOne({ userId: req.userId, dateKey: todayKey }).lean();
  }
};

/**
 * The AI failed earlier today, so the person got the rules' picks: try the AI
 * again. Only an AI answer replaces them (keeping anything already
 * dismissed); otherwise the next try waits another AI_RETRY_AFTER_MS.
 */
const retrySuggestionDay = async (req, day, existingTitles) => {
  const input = await loadSuggestionInput(req, day.dateKey, existingTitles);
  const result = await generateHabitSuggestions(input);
  logGenerated(req.userId, result, true);
  const update =
    result.source === 'ai'
      ? {
          source: 'ai',
          suggestions: result.suggestions,
          context: { phase: input.phase, goal: input.goal },
          aiFailed: false,
          attemptedAt: new Date(),
        }
      : { attemptedAt: new Date() };
  const updated = await HabitSuggestionDay.findOneAndUpdate(
    { _id: day._id, aiFailed: true },
    { $set: update },
    { new: true },
  ).lean();
  return updated || HabitSuggestionDay.findById(day._id).lean();
};

/**
 * GET /api/habits/suggestions — today's habit picks for this person. Made
 * once per local day (AI when allowed, rules otherwise), stored, and served
 * unchanged for the rest of the day; habits already added and picks
 * dismissed are left out. If the AI failed, it's tried again after a while.
 */
export const getHabitSuggestions = async (req, res, next) => {
  try {
    const todayKey = clientTodayKey(req);
    const habits = await Habit.find({ userId: req.userId, isActive: true }).select('title').lean();
    const existingTitles = habits.map((h) => h.title);
    const lockKey = `${req.userId}:${todayKey}`;

    let day = await HabitSuggestionDay.findOne({ userId: req.userId, dateKey: todayKey }).lean();
    if (!day) {
      day = await once(lockKey, () => createSuggestionDay(req, todayKey, existingTitles));
    } else if (shouldRetryAi(day, { aiOk: aiAllowed(req.user) && isAiConfigured() })) {
      day = await once(lockKey, () => retrySuggestionDay(req, day, existingTitles));
    }

    return sendResponse(res, HTTP_STATUS.OK, 'Habit suggestions fetched', {
      dateKey: todayKey,
      source: day?.source || 'rules',
      // true when nothing was logged lately: the app asks her to log instead.
      needsLogs: Boolean(day?.needsLogs),
      suggestions: visibleSuggestions(day, existingTitles),
    });
  } catch (error) {
    logger.error('habit_suggestions_error', { userId: req.userId, error: error.message });
    next(error);
  }
};

/**
 * POST /api/habits/suggestions/:key/dismiss — "Not for me": hides the pick
 * today, and it isn't suggested again for SUGGESTION_WINDOW_DAYS.
 */
export const dismissHabitSuggestion = async (req, res, next) => {
  try {
    const { key } = req.params;
    if (!isSuggestionKey(key)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid suggestion');
    }
    // No day stored (e.g. the day just changed): nothing to hide, still fine.
    await HabitSuggestionDay.updateOne(
      { userId: req.userId, dateKey: clientTodayKey(req) },
      { $addToSet: { dismissed: key } },
    );
    logger.info('habit_suggestion_dismissed', {
      action: 'habit_suggestion_dismissed',
      userId: req.userId,
      suggestionKey: key,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Suggestion dismissed');
  } catch (error) {
    next(error);
  }
};
