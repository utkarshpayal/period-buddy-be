import { timingSafeEqual } from 'node:crypto';
import mongoose from 'mongoose';

export const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const MONTH_KEY_REGEX = /^\d{4}-\d{2}$/;
export const HEX_COLOR_REGEX = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;

// mongoose.Types.ObjectId.isValid() also returns true for any 12-character
// string (it can build an ObjectId from 12 raw bytes), which wrongly treats
// 12-char slugs (e.g. "what-is-pcos") as ids. Require the canonical 24-char
// hex form so id-vs-slug routing behaves correctly.
export const isValidObjectId = (id) =>
  /^[0-9a-fA-F]{24}$/.test(String(id)) && mongoose.Types.ObjectId.isValid(id);

export const escapeRegex = (value = '') => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export const parsePositiveInt = (value, fallback, options = {}) => {
  const parsed = Number.parseInt(value, 10);
  const min = options.min ?? 1;
  const max = options.max ?? Number.MAX_SAFE_INTEGER;

  if (Number.isNaN(parsed)) return fallback;
  return Math.min(Math.max(parsed, min), max);
};

export const getPagination = (query = {}, defaults = {}) => {
  const page = parsePositiveInt(query.page, defaults.page ?? 1, { min: 1 });
  const limit = parsePositiveInt(query.limit, defaults.limit ?? 10, {
    min: 1,
    max: defaults.maxLimit ?? 50,
  });

  return {
    page,
    limit,
    skip: (page - 1) * limit,
  };
};

export const buildPagination = ({ page, limit, total }) => ({
  page,
  limit,
  total,
  pages: Math.ceil(total / limit) || 0,
  hasNextPage: page * limit < total,
  hasPrevPage: page > 1,
});

/**
 * True when the caller opted into pagination (sent ?page= or ?limit=).
 * Endpoints that used to return a bare array keep doing exactly that for
 * callers that don't opt in — installed app builds and older admin bundles
 * never send these params — and only switch to page-sized results when asked.
 */
export const isPaginatedRequest = (query = {}) =>
  query.page !== undefined || query.limit !== undefined;

/**
 * Sends a list whose `data` keeps its pre-pagination shape (usually a bare
 * array), with `pagination` (buildPagination) and any `extra` fields as
 * siblings on the envelope — so adding pagination to an endpoint never
 * breaks a client that reads `data` directly.
 */
export const sendPaginatedList = (res, message, data, pagination, extra = {}) =>
  res.status(200).json({
    success: true,
    statusCode: 200,
    message,
    data,
    pagination,
    ...extra,
  });

export const pickDefined = (source, fields) => {
  const result = {};

  fields.forEach((field) => {
    if (source[field] !== undefined) {
      result[field] = source[field];
    }
  });

  return result;
};

export const normalizeStringArray = (value) => {
  if (value === undefined || value === null || value === '') return [];

  const values = Array.isArray(value) ? value : String(value).split(',');

  return [...new Set(values.map((item) => String(item).trim()).filter(Boolean))];
};

export const normalizeBoolean = (value, fallback = false) => {
  if (value === undefined || value === null) return fallback;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.toLowerCase());
  return Boolean(value);
};

export const validateDateKey = (value) => DATE_KEY_REGEX.test(String(value));

export const validateMonthKey = (value) => MONTH_KEY_REGEX.test(String(value));

export const dateFromDateKey = (dateKey) => new Date(`${dateKey}T00:00:00.000Z`);

export const dateToDateKey = (date) => new Date(date).toISOString().slice(0, 10);

export const todayDateKey = () => dateToDateKey(new Date());

/**
 * The person's local "today" (YYYY-MM-DD). Day logs are keyed by the phone's
 * local date, so cycle day, phase and "days until" must count from it too,
 * not from server UTC (in India that's yesterday until 05:30). The app sends
 * `X-Timezone-Offset` (Date#getTimezoneOffset, e.g. -330 for IST) on every
 * request; `timezoneOffsetMinutes` in the query or body also works. Falls
 * back to UTC today.
 */
export const clientTodayKey = (req, now = new Date()) => {
  const raw =
    req?.get?.('X-Timezone-Offset') ??
    req?.query?.timezoneOffsetMinutes ??
    req?.body?.timezoneOffsetMinutes;
  const offset = Number(raw);
  if (
    raw === undefined ||
    raw === null ||
    raw === '' ||
    !Number.isInteger(offset) ||
    Math.abs(offset) > 840
  ) {
    return dateToDateKey(now);
  }
  return new Date(now.getTime() - offset * 60000).toISOString().slice(0, 10);
};

/** `clientTodayKey` as the UTC-midnight Date that computeCyclePredictions' `today` expects. */
export const clientToday = (req, now = new Date()) => dateFromDateKey(clientTodayKey(req, now));

export const createHttpError = (message, statusCode = 500) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

// crypto.timingSafeEqual throws on mismatched lengths rather than just
// returning false, so length-check first (a length leak is standard/
// acceptable for a shared secret) before the constant-time byte compare.
// Shared by every external-scheduler tick endpoint (checkinCallScheduler.js,
// dailyNotificationScheduler.js, ...) that authenticates via a header secret
// instead of a user JWT.
export const timingSafeEqualStrings = (a, b) => {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
};
