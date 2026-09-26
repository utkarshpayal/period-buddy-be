import CycleLog from '../models/CycleLog.js';
import CycleSettings from '../models/CycleSettings.js';
import CycleSyncTip from '../models/CycleSyncTip.js';
import HabitCompletion from '../models/HabitCompletion.js';
import CommunityPost from '../models/Community.js';
import BestieCircle from '../models/BestieCircle.js';
import User from '../models/User.js';
import { sendResponse, sendError } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import { isValidObjectId } from '../utils/apiHelpers.js';
import { recordAudit, AUDIT_ACTIONS } from '../utils/auditLog.js';
import { computeCyclePredictions, CYCLE_PHASES } from '../utils/cycle.js';
import {
  buildEra,
  buildWrapped,
  computeBadges,
  logMetrics,
  nextStreakMilestone,
  resolveWrappedRange,
} from '../utils/genz.js';
import {
  CYCLE_SYNC_CATEGORIES,
  CYCLE_SYNC_CATEGORY_LABELS,
  DEFAULT_CYCLE_SYNC_TIPS,
  PHASE_ERAS,
} from '../constants/cycleSync.js';
import logger from '../utils/logger.js';

const LOG_FIELDS = 'dateKey flow mood moods symptoms sleepHours waterIntake stressLevel';

/** The client's local date from `?tz=` (getTimezoneOffset() minutes), else UTC. */
const clientTodayKey = (tz) => {
  const offset = Number(tz);
  const now = Number.isFinite(offset) ? Date.now() - offset * 60000 : Date.now();
  return new Date(now).toISOString().slice(0, 10);
};

/** Active tips from the DB, or the built-in defaults while it's empty. */
const loadTips = async () => {
  const saved = await CycleSyncTip.find().sort({ order: 1 }).lean();
  return saved.length ? saved : DEFAULT_CYCLE_SYNC_TIPS;
};

/* ---------------------------------- App ---------------------------------- */

/** GET /api/genz/wrapped?period=month|year&value=YYYY-MM|YYYY&tz= */
export const getWrapped = async (req, res, next) => {
  try {
    const todayKey = clientTodayKey(req.query.tz);
    const range = resolveWrappedRange(
      req.query.period || 'month',
      req.query.value,
      new Date(`${todayKey}T12:00:00Z`),
    );
    if (!range) return sendError(res, HTTP_STATUS.BAD_REQUEST, 'period must be month or year');

    // Up to a year before the range, so the first cycle length in it is known.
    const historyFrom = `${Number(range.fromKey.slice(0, 4)) - 1}${range.fromKey.slice(4)}`;
    const logs = await CycleLog.find({
      userId: req.userId,
      dateKey: { $gte: historyFrom, $lte: range.toKey },
    })
      .select(LOG_FIELDS)
      .sort({ dateKey: 1 })
      .lean();

    const wrapped = buildWrapped(logs, range, todayKey);
    logger.info('genz_wrapped_fetched', {
      action: 'genz_wrapped_fetched',
      userId: req.userId,
      period: range.period,
      label: range.label,
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Wrapped ready', { wrapped });
  } catch (error) {
    next(error);
  }
};

/** GET /api/genz/era — today's phase era and cycle-syncing tips. */
export const getEra = async (req, res, next) => {
  try {
    const settings = await CycleSettings.findOne({ userId: req.userId }).lean();
    if (!settings) {
      return sendError(res, HTTP_STATUS.NOT_FOUND, 'Please set up your cycle settings first');
    }
    const [logs, tips] = await Promise.all([
      CycleLog.find({ userId: req.userId }).select('dateKey flow').sort({ dateKey: 1 }).lean(),
      loadTips(),
    ]);
    const predictions = computeCyclePredictions(settings, logs);
    return sendResponse(res, HTTP_STATUS.OK, 'Era ready', {
      era: buildEra(predictions, tips),
      eras: PHASE_ERAS,
    });
  } catch (error) {
    next(error);
  }
};

const loadBadgeMetrics = async (userId) => {
  const [logs, habitCompletions, communityPosts, circles] = await Promise.all([
    CycleLog.find({ userId }).select(LOG_FIELDS).lean(),
    HabitCompletion.countDocuments({ userId }),
    CommunityPost.countDocuments({ userId }),
    BestieCircle.countDocuments({ 'members.userId': userId }),
  ]);
  return { ...logMetrics(logs), habitCompletions, communityPosts, circles };
};

/** GET /api/genz/badges — streak, next milestone and every badge with progress. */
export const getBadges = async (req, res, next) => {
  try {
    const [metrics, user] = await Promise.all([
      loadBadgeMetrics(req.userId),
      User.findById(req.userId).select('streakCount').lean(),
    ]);
    // Fresh accounts carry the schema default streakCount of 1 before any log.
    const currentStreak = metrics.totalLogs ? (user?.streakCount ?? 0) : 0;
    const badges = computeBadges(metrics);
    return sendResponse(res, HTTP_STATUS.OK, 'Badges ready', {
      streak: {
        current: currentStreak,
        longest: Math.max(metrics.longestStreak, currentStreak),
        nextMilestone: nextStreakMilestone(currentStreak),
      },
      earnedCount: badges.filter((b) => b.earned).length,
      badges,
    });
  } catch (error) {
    next(error);
  }
};

/* ---------------------------------- CMS ---------------------------------- */

const parseTipInput = (body = {}) => {
  const phase = body.phase;
  const category = body.category;
  if (!CYCLE_PHASES.includes(phase)) return { error: 'Pick a phase' };
  if (!CYCLE_SYNC_CATEGORIES.includes(category)) return { error: 'Pick a category' };
  const title = String(body.title ?? '').trim();
  if (!title) return { error: 'Add a title' };
  if (title.length > 60) return { error: 'Titles are 60 characters max' };
  const tipBody = String(body.body ?? '').trim();
  if (tipBody.length > 200) return { error: 'Tips are 200 characters max' };
  const emoji = String(body.emoji ?? '').trim();
  if (emoji.length > 16) return { error: 'Use a single emoji' };
  const order = Number.isFinite(Number(body.order)) ? Number(body.order) : 0;
  return {
    tip: { phase, category, title, body: tipBody, emoji, active: body.active !== false, order },
  };
};

/** GET /api/cms/cycle-sync-tips */
export const listTips = async (req, res, next) => {
  try {
    const saved = await CycleSyncTip.find().sort({ phase: 1, category: 1, order: 1 }).lean();
    return sendResponse(res, HTTP_STATUS.OK, 'Tips fetched', {
      tips: saved.length ? saved : DEFAULT_CYCLE_SYNC_TIPS,
      usingDefaults: saved.length === 0,
      phases: CYCLE_PHASES,
      categories: CYCLE_SYNC_CATEGORIES,
      categoryLabels: CYCLE_SYNC_CATEGORY_LABELS,
      eras: PHASE_ERAS,
    });
  } catch (error) {
    next(error);
  }
};

/**
 * POST /api/cms/cycle-sync-tips/seed — copy the built-in defaults into the
 * database so they can be edited. 409 once there are saved tips.
 */
export const seedTips = async (req, res, next) => {
  try {
    if (await CycleSyncTip.exists({})) {
      return sendError(res, HTTP_STATUS.CONFLICT, 'Tips have already been customised');
    }
    const tips = await CycleSyncTip.insertMany(
      DEFAULT_CYCLE_SYNC_TIPS.map((t) => ({ ...t, updatedBy: req.userId })),
    );
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_TIPS_SEEDED,
      resourceType: 'cycle_sync_tip',
      metadata: { count: tips.length },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Defaults copied', { tips });
  } catch (error) {
    next(error);
  }
};

/** POST /api/cms/cycle-sync-tips */
export const createTip = async (req, res, next) => {
  try {
    const parsed = parseTipInput(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    // The first custom tip replaces the defaults wholesale; copy them in first
    // so adding one tip doesn't silently wipe the other 25 from the app.
    if (!(await CycleSyncTip.exists({}))) {
      await CycleSyncTip.insertMany(
        DEFAULT_CYCLE_SYNC_TIPS.map((t) => ({ ...t, updatedBy: req.userId })),
      );
    }
    const tip = await CycleSyncTip.create({ ...parsed.tip, updatedBy: req.userId });
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_TIP_CREATED,
      resourceType: 'cycle_sync_tip',
      resourceId: String(tip._id),
      metadata: { phase: tip.phase, category: tip.category, title: tip.title },
    });
    return sendResponse(res, HTTP_STATUS.CREATED, 'Tip added', { tip });
  } catch (error) {
    next(error);
  }
};

/** PUT /api/cms/cycle-sync-tips/:id */
export const updateTip = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid tip id');
    }
    const parsed = parseTipInput(req.body);
    if (parsed.error) return sendError(res, HTTP_STATUS.BAD_REQUEST, parsed.error);
    const tip = await CycleSyncTip.findByIdAndUpdate(
      req.params.id,
      { $set: { ...parsed.tip, updatedBy: req.userId } },
      { new: true, runValidators: true },
    ).lean();
    if (!tip) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Tip not found');
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_TIP_UPDATED,
      resourceType: 'cycle_sync_tip',
      resourceId: String(tip._id),
      metadata: { phase: tip.phase, category: tip.category, active: tip.active },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Tip saved', { tip });
  } catch (error) {
    next(error);
  }
};

/** DELETE /api/cms/cycle-sync-tips/:id */
export const deleteTip = async (req, res, next) => {
  try {
    if (!isValidObjectId(req.params.id)) {
      return sendError(res, HTTP_STATUS.BAD_REQUEST, 'Invalid tip id');
    }
    const tip = await CycleSyncTip.findByIdAndDelete(req.params.id).lean();
    if (!tip) return sendError(res, HTTP_STATUS.NOT_FOUND, 'Tip not found');
    recordAudit({
      req,
      action: AUDIT_ACTIONS.CMS_TIP_DELETED,
      resourceType: 'cycle_sync_tip',
      resourceId: String(tip._id),
      metadata: { phase: tip.phase, title: tip.title },
    });
    return sendResponse(res, HTTP_STATUS.OK, 'Tip deleted', { id: String(tip._id) });
  } catch (error) {
    next(error);
  }
};
