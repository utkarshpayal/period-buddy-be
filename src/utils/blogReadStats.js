/**
 * Real reading-time analytics for blogs (pure, unit-tested).
 *
 * The app reports *active* reading time: seconds the article was on screen
 * with the app in the foreground, pausing after a minute with no scroll or
 * touch (period-buddy's lib/readTimer.ts). One reading session may arrive in
 * parts: when the app goes to the background it sends what it has, and later
 * parts carry `continued: true` so they add time without counting a second
 * read. `completed: true` comes once per session, when the reader first
 * reaches the end of the article.
 */

/** Shorter first parts are bounces (opened by mistake), not reads. */
export const MIN_READ_SECONDS = 5;

/**
 * Longest one session may count: three times the article's length, between
 * 10 and 60 minutes, so a phone left on the article can't skew the average.
 */
export const sessionCapSeconds = (readTimeMinutes) => {
  const estimate = Math.max(1, Number(readTimeMinutes) || 1) * 60 * 3;
  return Math.min(60 * 60, Math.max(10 * 60, estimate));
};

/** `{ seconds, continued, completed }` from a track-view body, or `{ error }`. */
export const parseReadReport = (body = {}) => {
  const seconds = Number(body.durationSeconds);
  if (!Number.isFinite(seconds) || seconds < 0)
    return { error: 'A valid durationSeconds is required' };
  return {
    seconds: Math.round(seconds),
    continued: body.continued === true,
    completed: body.completed === true,
  };
};

/**
 * What one report adds, or null when it shouldn't count (a bounce, or an
 * empty continuation). `reader` is this person's BlogReader row before the
 * report (null on their first read), so views and completions count each
 * person once: `blog` is the Blog's `$inc`, `reader` the BlogReader's.
 * Reading time and sessions count every visit.
 */
export const readIncrement = (
  { seconds, continued, completed },
  readTimeMinutes,
  reader = null,
) => {
  const counted = Math.min(seconds, sessionCapSeconds(readTimeMinutes));
  if (!continued && counted < MIN_READ_SECONDS) return null;
  if (continued && counted <= 0 && !completed) return null;
  const blog = { totalReadSeconds: counted };
  const readerInc = { totalReadSeconds: counted };
  if (!continued) {
    blog.readSessionCount = 1;
    readerInc.sessionCount = 1;
  }
  if (!reader) blog.viewCount = 1;
  const firstCompletion = completed && !reader?.completed;
  if (firstCompletion) blog.completedReadCount = 1;
  return { blog, reader: readerInc, completed: firstCompletion };
};

/**
 * Averages for the app and the admin portal; nulls until anyone has read.
 * `readerCount` is unique readers (= viewCount), the time average is per
 * visit, and the completion rate is the share of readers who reached the end.
 */
export const readStats = ({
  totalReadSeconds = 0,
  readSessionCount = 0,
  completedReadCount = 0,
  viewCount = 0,
} = {}) => {
  const readerCount = Math.max(viewCount || 0, 0);
  if (!(readSessionCount > 0)) {
    return {
      averageReadSeconds: null,
      averageReadMinutes: null,
      completionRate: null,
      readSessionCount: 0,
      readerCount,
    };
  }
  const averageReadSeconds = Math.round(totalReadSeconds / readSessionCount);
  const base = readerCount || readSessionCount;
  return {
    averageReadSeconds,
    averageReadMinutes: Math.max(1, Math.round(averageReadSeconds / 60)),
    completionRate: Math.min(1, completedReadCount / base),
    readSessionCount,
    readerCount,
  };
};
