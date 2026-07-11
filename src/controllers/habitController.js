import Habit from '../models/Habit.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { HEX_COLOR_REGEX, isValidObjectId, todayDateKey } from '../utils/apiHelpers.js';

const DEFAULT_HABITS = [
  { title: 'Log Period Tracking Data', icon: 'calendar-outline', color: '#d946a6', tokens: 50 },
  { title: 'Drink 8 Glasses of Water', icon: 'water-outline', color: '#06b6d4', tokens: 30 },
  { title: 'Exercise or Sync Movement', icon: 'fitness-outline', color: '#22c55e', tokens: 60 },
  { title: 'Mindfulness Meditation', icon: 'heart-outline', color: '#ec4899', tokens: 40 },
];

const calculateStreak = (completedDates = []) => {
  const dates = new Set(completedDates);
  let streak = 0;
  const cursor = new Date();

  while (dates.has(cursor.toISOString().slice(0, 10))) {
    streak += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  return streak;
};

/** GET /api/habits — Get user's active habits with today's completion status */
export const getHabits = async (req, res, next) => {
  try {
    let habits = await Habit.find({ userId: req.userId, isActive: true }).sort({ createdAt: 1 });

    // Seed defaults if user has no habits
    if (habits.length === 0) {
      const docs = DEFAULT_HABITS.map(h => ({ ...h, userId: req.userId, streak: 0 }));
      habits = await Habit.insertMany(docs);
      logger.info('habits_seeded', { action: 'habits_seeded', userId: req.userId });
    }

    const todayKey = todayDateKey();
    const result = habits.map(h => ({
      id: h._id,
      title: h.title,
      icon: h.icon,
      color: h.color,
      tokens: h.tokens,
      streak: h.streak,
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
    const { title, icon, color } = req.body;
    const tokens = req.body.tokens === undefined ? 30 : Number(req.body.tokens);

    if (!title?.trim()) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Habit title is required');
    }
    if (title.trim().length > 100) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Habit title must be 100 characters or fewer');
    }
    if (!Number.isInteger(tokens) || tokens < 1 || tokens > 200) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'tokens must be an integer between 1 and 200');
    }
    if (color && !HEX_COLOR_REGEX.test(color)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'color must be a valid hex color');
    }

    const habit = await Habit.create({
      userId: req.userId,
      title: title.trim(),
      icon,
      color,
      tokens,
    });

    logger.info('habit_created', { action: 'habit_created', userId: req.userId, habitId: habit._id, title });

    return sendResponse(res, HTTP_STATUS.CREATED, 'Habit created', {
      id: habit._id, title: habit.title, icon: habit.icon, color: habit.color, tokens: habit.tokens, streak: 0, completed: false,
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

    const habit = await Habit.findOne({ _id: req.params.id, userId: req.userId });
    if (!habit) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Habit not found');
    }

    const todayKey = todayDateKey();
    const alreadyDone = habit.completedDates.includes(todayKey);

    let tokensAwarded = 0;
    if (alreadyDone) {
      // Uncomplete
      habit.completedDates = habit.completedDates.filter(d => d !== todayKey);
      habit.streak = calculateStreak(habit.completedDates);
      tokensAwarded = -habit.tokens;
      const user = await User.findById(req.userId);
      if (user) {
        user.tokenEarned = Math.max(0, (user.tokenEarned || 0) + tokensAwarded);
        await user.save();
      }
    } else {
      // Complete
      habit.completedDates.push(todayKey);
      habit.streak = calculateStreak(habit.completedDates);
      tokensAwarded = habit.tokens;
      await User.findByIdAndUpdate(req.userId, { $inc: { tokenEarned: tokensAwarded } });
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
      { new: true }
    );
    if (!habit) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Habit not found');

    logger.info('habit_deleted', { action: 'habit_deleted', userId: req.userId, habitId: habit._id });

    return sendResponse(res, HTTP_STATUS.OK, 'Habit removed');
  } catch (error) {
    next(error);
  }
};
