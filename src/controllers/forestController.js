import CycleLog from '../models/CycleLog.js';
import ForestLog from '../models/ForestLog.js';
import Habit from '../models/Habit.js';
import HabitCompletion from '../models/HabitCompletion.js';
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
import {
  buildTaskDays,
  computeForestGrowth,
  hasCycleEntry,
  shiftDateKey,
} from '../utils/forestGrowth.js';

const getTier = (healthyTreeCount) => {
  if (healthyTreeCount >= 20) return 'Ancient Evergreen Canopy';
  if (healthyTreeCount >= 14) return 'Lush Tropical Forest';
  if (healthyTreeCount >= 7) return 'Growing Cycle Grove';
  return 'Sprout Woodland';
};

// The caller's local date (?today=), trusted only within a day of the server's
// UTC date, so the app's "today" matches the day its logs are saved under.
const resolveToday = (clientToday) => {
  const serverToday = todayDateKey();
  if (
    validateDateKey(clientToday) &&
    [shiftDateKey(serverToday, -1), serverToday, shiftDateKey(serverToday, 1)].includes(clientToday)
  ) {
    return clientToday;
  }
  return serverToday;
};

/**
 * Accounts listed in FOREST_FULL_HISTORY_EMAILS (comma-separated, testing
 * only) have their forest counted from all their history instead of the last
 * year, so a big forest can be seeded (src/scripts/seedForestDemo.js).
 * Unset: everyone gets the one-year window.
 */
export const forestHistoryStart = (email, today, env = process.env) => {
  const listed = String(env.FOREST_FULL_HISTORY_EMAILS || '')
    .split(',')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  if (email && listed.includes(String(email).trim().toLowerCase())) return '0000-01-01';
  return shiftDateKey(today, -365);
};

// A year of task dates is plenty: a tree takes about three weeks.
const loadForestGrowth = async (userId, habits, today, since = shiftDateKey(today, -365)) => {
  const [cycleLogs, completions, waterings] = await Promise.all([
    CycleLog.find({ userId, dateKey: { $gte: since } }).lean(),
    HabitCompletion.find({ userId, dateKey: { $gte: since } }, { dateKey: 1 }).lean(),
    ForestLog.find({ userId, dateKey: { $gte: since } }, { dateKey: 1 }).lean(),
  ]);
  return computeForestGrowth(
    buildTaskDays({
      logDates: cycleLogs.filter(hasCycleEntry).map((log) => log.dateKey),
      // completedDates still holds completions made before HabitCompletion existed.
      habitDates: [
        ...completions.map((c) => c.dateKey),
        ...habits.flatMap((h) => h.completedDates || []).filter((key) => key >= since),
      ],
      waterDates: waterings.map((w) => w.dateKey),
    }),
    today,
  );
};

const calculateForest = async (userId, today = todayDateKey()) => {
  const [cycleLogs, habits, forestLogs, user] = await Promise.all([
    CycleLog.find({ userId }).sort({ dateKey: -1 }).limit(120),
    Habit.find({ userId, isActive: true }),
    ForestLog.find({ userId }).sort({ dateKey: -1 }).limit(120),
    User.findById(userId),
  ]);

  const trackedDays = cycleLogs.filter(
    (log) =>
      log.note?.trim() || (log.symptoms || []).length > 0 || (log.flow && log.flow !== 'none'),
  ).length;
  const habitCompletions = habits.reduce(
    (sum, habit) => sum + (habit.completedDates?.length || 0),
    0,
  );
  const careScore = forestLogs.reduce((sum, log) => sum + (log.healthDelta || 0), 0);
  const currentHealth = Math.min(
    100,
    Math.max(30, 45 + trackedDays * 3 + habitCompletions + careScore),
  );
  const healthyTreeCount = Math.max(
    1,
    Math.floor((trackedDays + habitCompletions + forestLogs.length) / 2),
  );

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
    todayCareLogged: forestLogs.some((log) => log.dateKey === today),
    growth: await loadForestGrowth(userId, habits, today, forestHistoryStart(user?.email, today)),
  };
};

export const getForestStatus = async (req, res, next) => {
  try {
    const status = await calculateForest(req.userId, resolveToday(req.query.today));
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
      return sendError(
        res,
        HTTP_STATUS.BAD_REQUEST,
        `careType must be one of: ${allowedTypes.join(', ')}`,
      );
    }

    // Whether today's bonus was already awarded is derived from the upsert's
    // own result (`updatedExisting`), not a prior separate `findOne` — two
    // concurrent requests for the same (userId, dateKey) both used to read
    // "not yet logged" before either write landed, so both `$inc`ed the
    // wallet even though ForestLog's unique index made the upsert itself
    // land as one document (silently double/triple-crediting tokens with no
    // error at all). `healthDelta`/`rewardPoints` are only ever set on the
    // insert branch (`$setOnInsert`) so a concurrent update can't stomp them.
    const result = await ForestLog.findOneAndUpdate(
      { userId: req.userId, dateKey },
      {
        $set: {
          careType,
          note: req.body.note?.trim() || '',
          duration: req.body.duration !== undefined ? Number(req.body.duration) : undefined,
          treeType: req.body.treeType?.trim(),
          completed: req.body.completed !== undefined ? !!req.body.completed : undefined,
        },
        $setOnInsert: {
          healthDelta: 5,
          rewardPoints: 5,
        },
      },
      { new: true, upsert: true, runValidators: true, includeResultMetadata: true },
    );

    const log = result.value;
    const existing = Boolean(result.lastErrorObject?.updatedExisting);
    const tokensEarned = existing ? 0 : 5;

    if (existing) {
      // Not the request that created today's row — its `rewardPoints` stays
      // at the value the creating request set (5), reflecting "5 tokens were
      // earned for today," not "5 tokens were earned by this specific call."
    } else {
      await User.findByIdAndUpdate(req.userId, { $inc: { walletBalance: tokensEarned } });
    }

    const status = await calculateForest(req.userId, resolveToday(req.body.today || dateKey));

    return sendResponse(
      res,
      existing ? HTTP_STATUS.OK : HTTP_STATUS.CREATED,
      existing ? 'Forest care updated' : 'Forest care logged',
      {
        log,
        tokensEarned,
        status,
      },
    );
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
