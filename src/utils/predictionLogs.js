import CycleLog from '../models/CycleLog.js';

// computeCyclePredictions (utils/cycle.js#derivePeriodEpisodes) reads only
// `dateKey` and `flow` from each log; nothing in a prediction depends on
// the rest of the day log (note is encrypted, so never load it for this).
export const PREDICTION_LOG_FIELDS = 'dateKey flow';

/**
 * A user's full cycle-log history, trimmed to what computeCyclePredictions
 * needs (plus `extraFields`, a space-separated list, for callers that also
 * read e.g. symptoms), oldest first. Plain objects (lean), so don't save
 * them, and schema defaults aren't applied (a missing `symptoms` is
 * undefined, not []).
 */
export const predictionLogFields = (extraFields = '') =>
  [...new Set(`${PREDICTION_LOG_FIELDS} ${extraFields}`.split(/\s+/).filter(Boolean))].join(' ');

export const loadPredictionLogs = (userId, { extraFields = '' } = {}) =>
  CycleLog.find({ userId }).sort({ dateKey: 1 }).select(predictionLogFields(extraFields)).lean();
