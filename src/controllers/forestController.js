import CycleLog from '../models/CycleLog.js';
import ForestLog from '../models/ForestLog.js';
import Habit from '../models/Habit.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import {
  buildPagination,
  getPagination,
  todayDateKey,
  validateDateKey,
  validateMonthKey,
} from '../utils/apiHelpers.js';

const getTier = (healthyTreeCount) => {
  if (healthyTreeCount >= 20) return 'Ancient Evergreen Canopy';
  if (healthyTreeCount >= 14) return 'Lush Tropical Forest';
  if (healthyTreeCount >= 7) return 'Growing Cycle Grove';
  return 'Sprout Woodland';
};

const calculateForest = async (userId) => {
  const [cycleLogs, habits, forestLogs, user] = await Promise.all([
    CycleLog.find({ userId }).sort({ dateKey: -1 }).limit(120),
    Habit.find({ userId, isActive: true }),
    ForestLog.find({ userId }).sort({ dateKey: -1 }).limit(120),
    User.findById(userId),
  ]);

  const trackedDays = cycleLogs.filter((log) =>
    log.note?.trim() || (log.symptoms || []).length > 0 || (log.flow && log.flow !== 'none')
  ).length;
  const habitCompletions = habits.reduce((sum, habit) => sum + (habit.completedDates?.length || 0), 0);
  const careScore = forestLogs.reduce((sum, log) => sum + (log.healthDelta || 0), 0);
  const currentHealth = Math.min(100, Math.max(30, 45 + trackedDays * 3 + habitCompletions + careScore));
  const healthyTreeCount = Math.max(1, Math.floor((trackedDays + habitCompletions + forestLogs.length) / 2));

  const monthlyMap = new Map();
  [...cycleLogs, ...forestLogs].forEach((entry) => {
    if (!entry.dateKey) return;
    const month = entry.dateKey.slice(0, 7);
    const current = monthlyMap.get(month) || {
      month,
      health: 45,
      loggedDays: 0,
      careActions: 0,
    };

    if (entry.flow !== undefined) current.loggedDays += 1;
    if (entry.careType !== undefined) current.careActions += 1;
    current.health = Math.min(100, current.health + 5);
    monthlyMap.set(month, current);
  });

  const trees = [...monthlyMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-6)
    .map((item) => ({
      ...item,
      status: item.health >= 70 ? 'healthy' : item.health >= 45 ? 'wilted' : 'dead',
    }));

  return {
    tokens: user?.walletBalance || 0,
    currentHealth,
    healthyTreeCount,
    averageHealth: trees.length
      ? Math.round(trees.reduce((sum, tree) => sum + tree.health, 0) / trees.length)
      : currentHealth,
    forestTier: getTier(healthyTreeCount),
    trackedDays,
    careActions: forestLogs.length,
    activeHabits: habits.length,
    trees,
    todayCareLogged: forestLogs.some((log) => log.dateKey === todayDateKey()),
  };
};

export const getForestStatus = async (req, res, next) => {
  try {
    const status = await calculateForest(req.userId);
    return sendResponse(res, HTTP_STATUS.OK, 'Forest status fetched', status);
  } catch (error) {
    next(error);
  }
};

export const logForestCare = async (req, res, next) => {
  try {
    const dateKey = req.body.dateKey || todayDateKey();
    if (!validateDateKey(dateKey)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'dateKey must be in YYYY-MM-DD format');
    }

    const careType = req.body.careType || 'manual';
    const allowedTypes = ['water', 'symptom_log', 'habit_completion', 'reflection', 'manual'];
    if (!allowedTypes.includes(careType)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, `careType must be one of: ${allowedTypes.join(', ')}`);
    }

    const existing = await ForestLog.findOne({ userId: req.userId, dateKey });
    const tokensEarned = existing ? 0 : 5;

    const log = await ForestLog.findOneAndUpdate(
      { userId: req.userId, dateKey },
      {
        careType,
        note: req.body.note?.trim() || '',
        healthDelta: existing ? existing.healthDelta : 5,
        rewardPoints: tokensEarned,
        duration: req.body.duration !== undefined ? Number(req.body.duration) : undefined,
        treeType: req.body.treeType?.trim(),
        completed: req.body.completed !== undefined ? !!req.body.completed : undefined,
      },
      { new: true, upsert: true, runValidators: true }
    );

    if (tokensEarned > 0) {
      await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: tokensEarned } });
    }

    const status = await calculateForest(req.userId);

    return sendResponse(res, existing ? HTTP_STATUS.OK : HTTP_STATUS.CREATED, existing ? 'Forest care updated' : 'Forest care logged', {
      log,
      tokensEarned,
      status,
    });
  } catch (error) {
    next(error);
  }
};

export const getForestLogs = async (req, res, next) => {
  try {
    const { month } = req.query;
    const { page, limit, skip } = getPagination(req.query, { limit: 20, maxLimit: 100 });

    const filter = { userId: req.userId };
    if (month) {
      if (!validateMonthKey(month)) {
        return sendError(res, HTTP_STATUS.BAD_REQUEST, 'month must be in YYYY-MM format');
      }
      filter.dateKey = { $regex: `^${month}` };
    }

    const [logs, total] = await Promise.all([
      ForestLog.find(filter).sort({ dateKey: -1 }).skip(skip).limit(limit),
      ForestLog.countDocuments(filter),
    ]);

    return sendResponse(res, HTTP_STATUS.OK, 'Forest logs fetched', {
      logs,
      pagination: buildPagination({ page, limit, total }),
    });
  } catch (error) {
    next(error);
  }
};
