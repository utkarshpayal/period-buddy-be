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

/** Whether anyone is on the full-history list, i.e. whether `since` needs the user's email. */
const hasFullHistoryList = (env = process.env) =>
  String(env.FOREST_FULL_HISTORY_EMAILS || '').trim() !== '';

// Only the fields the summary reads (lean, no Mongoose documents).
const RECENT_LOG_FIELDS = { dateKey: 1, note: 1, symptoms: 1, flow: 1 };
const RECENT_CARE_FIELDS = { dateKey: 1, healthDelta: 1 };

// A year of task dates is plenty: a tree takes about three weeks.
// Every query here is served by a { userId, dateKey } index.
const loadGrowthDates = async (userId, since) => {
  const [cycleLogs, completions, waterings] = await Promise.all([
    // hasCycleEntry looks at every field, so these stay whole (but lean).
    CycleLog.find(
      { userId, dateKey: { $gte: since } },
      { userId: 0, createdAt: 0, updatedAt: 0, __v: 0 },
    ).lean(),
    HabitCompletion.find({ userId, dateKey: { $gte: since } }, { _id: 0, dateKey: 1 }).lean(),
    ForestLog.find({ userId, dateKey: { $gte: since } }, { _id: 0, dateKey: 1 }).lean(),
  ]);
  return {
    logDates: cycleLogs.filter(hasCycleEntry).map((log) => log.dateKey),
    completionDates: completions.map((c) => c.dateKey),
    waterDates: waterings.map((w) => w.dateKey),
  };
};

/**
 * Everything for the status comes from one round of parallel, lean,
 * projected queries (it used to load full documents, then wait for the user
 * before a second round for the growth dates).
 */
const calculateForest = async (userId, today = todayDateKey()) => {
  const userPromise = User.findById(userId).select('walletBalance email').lean().exec();
  // The growth window only depends on the user when the testing list is set.
  const sincePromise = hasFullHistoryList()
    ? userPromise.then((u) => forestHistoryStart(u?.email, today))
    : Promise.resolve(forestHistoryStart(undefined, today));

  const [cycleLogs, habits, forestLogs, user, since, growthDates] = await Promise.all([
    CycleLog.find({ userId }, RECENT_LOG_FIELDS).sort({ dateKey: -1 }).limit(120).lean(),
    Habit.find({ userId, isActive: true }, { completedDates: 1 }).lean(),
    ForestLog.find({ userId }, RECENT_CARE_FIELDS).sort({ dateKey: -1 }).limit(120).lean(),
    userPromise,
    sincePromise,
    sincePromise.then((s) => loadGrowthDates(userId, s)),
  ]);

  const trackedDays = cycleLogs.filter(
    (log) =>
      log.note?.trim() || (log.symptoms || []).length > 0 || (log.flow && log.flow !== 'none'),
  ).length;
  const habitCompletions = habits.reduce(
    (sum, habit) => sum + (habit.completedDates?.length || 0),
    0,
  );
  const careScore = forestLogs.reduce((sum, log) => sum + (log.healthDelta ?? 5), 0);
  const currentHealth = Math.min(
    100,
    Math.max(30, 45 + trackedDays * 3 + habitCompletions + careScore),
  );
  const healthyTreeCount = Math.max(
    1,
    Math.floor((trackedDays + habitCompletions + forestLogs.length) / 2),
  );

  const monthlyMap = new Map();
  const addToMonth = (dateKey, field) => {
    if (!dateKey) return;
    const month = dateKey.slice(0, 7);
    const current = monthlyMap.get(month) || { month, health: 45, loggedDays: 0, careActions: 0 };
    current[field] += 1;
    current.health = Math.min(100, current.health + 5);
    monthlyMap.set(month, current);
  };
  cycleLogs.forEach((log) => addToMonth(log.dateKey, 'loggedDays'));
  forestLogs.forEach((log) => addToMonth(log.dateKey, 'careActions'));

  const trees = [...monthlyMap.values()]
    .sort((a, b) => a.month.localeCompare(b.month))
    .slice(-6)
    .map((item) => ({
      ...item,
      status: item.health >= 70 ? 'healthy' : item.health >= 45 ? 'wilted' : 'dead',
    }));

  const growth = computeForestGrowth(
    buildTaskDays({
      logDates: growthDates.logDates,
      // completedDates still holds completions made before HabitCompletion existed.
      habitDates: [
        ...growthDates.completionDates,
        ...habits.flatMap((h) => h.completedDates || []).filter((key) => key >= since),
      ],
      waterDates: growthDates.waterDates,
    }),
    today,
  );

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
    growth,
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
      ForestLog.find(filter).sort({ dateKey: -1 }).skip(skip).limit(limit).lean(),
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
