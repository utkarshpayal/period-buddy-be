import Habit from '../models/Habit.js';
import HabitCompletion from '../models/HabitCompletion.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { HEX_COLOR_REGEX, isValidObjectId, todayDateKey } from '../utils/apiHelpers.js';

const DEFAULT_HABITS = [
  {
    title: 'Log Period Tracking Data',
    icon: 'calendar-outline',
    color: '#d946a6',
    rewardPoints: 50,
  },
  { title: 'Drink 8 Glasses of Water', icon: 'water-outline', color: '#06b6d4', rewardPoints: 30 },
  {
    title: 'Exercise or Sync Movement',
    icon: 'fitness-outline',
    color: '#22c55e',
    rewardPoints: 60,
  },
  { title: 'Mindfulness Meditation', icon: 'heart-outline', color: '#ec4899', rewardPoints: 40 },
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
      const docs = DEFAULT_HABITS.map((h) => ({ ...h, userId: req.userId, streak: 0 }));
      habits = await Habit.insertMany(docs);
      logger.info('habits_seeded', { action: 'habits_seeded', userId: req.userId });
    }

    const todayKey = todayDateKey();
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
      streak: calculateStreak(h.completedDates),
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

    const habit = await Habit.create({
      userId: req.userId,
      title: title.trim(),
      icon,
      color,
      rewardPoints,
      frequency: frequency || 'daily',
      target: target !== undefined ? Number(target) : 1,
      reminderTime: reminderTime?.trim(),
    });

    logger.info('habit_created', {
      action: 'habit_created',
      userId: req.userId,
      habitId: habit._id,
      title,
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
      streak: 0,
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

    const habit = await Habit.findOne({ _id: req.params.id, userId: req.userId });
    if (!habit) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Habit not found');
    }

    const todayKey = todayDateKey();
    const alreadyDone = habit.completedDates.includes(todayKey);

    let tokensAwarded = 0;
    if (alreadyDone) {
      // Uncomplete
      habit.completedDates = habit.completedDates.filter((d) => d !== todayKey);
      habit.streak = calculateStreak(habit.completedDates);
      tokensAwarded = -(habit.rewardPoints || 30);
      const user = await User.findById(req.userId);
      if (user) {
        user.walletBalance = Math.max(0, (user.walletBalance || 0) + tokensAwarded);
        await user.save();
      }
      await HabitCompletion.deleteOne({ habitId: habit._id, dateKey: todayKey });
    } else {
      // Complete
      habit.completedDates.push(todayKey);
      habit.streak = calculateStreak(habit.completedDates);
      tokensAwarded = habit.rewardPoints || 30;
      await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: tokensAwarded } });
      await HabitCompletion.create({
        habitId: habit._id,
        userId: req.userId,
        dateKey: todayKey,
        rewardPoints: habit.rewardPoints || 30,
      });
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
