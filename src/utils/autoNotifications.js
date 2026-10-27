import { dateToDateKey, dateFromDateKey } from './apiHelpers.js';
import { getCyclePhase } from './cycle.js';

/**
 * Automatic cycle notifications: which ones exist, what each user has
 * switched on, and which are due for one user on their local "today".
 * Pure (no DB), unit-tested in __tests__/autoNotifications.test.js; the
 * hourly tick that sends them is dailyNotificationScheduler.js.
 *
 * Modelled on what Flo and Clue send: period coming / due / late, fertile
 * window and ovulation, a tip when a new phase starts, a heads-up for the
 * person's own usual symptoms, and a gentle "log today". Each category is a
 * switch in the app (Profile → Notifications) and can be turned off for
 * everyone by an admin (AutoNotificationConfig). At most MAX_PER_DAY go out
 * per person per day, most important first, and the daily log reminder only
 * on days nothing else was sent.
 */

export const AUTO_NOTIFICATIONS = [
  {
    key: 'health_alerts',
    label: 'Cycle health alerts',
    description: 'When something in your cycle is worth a doctor’s look',
    defaultOn: true,
    priority: 0,
    pausedInPregnancy: true,
  },
  {
    key: 'period_late',
    label: 'Late period',
    description: 'If your period hasn’t been logged a few days after it was due',
    defaultOn: true,
    priority: 1,
    pausedInPregnancy: true,
  },
  {
    key: 'period_upcoming',
    label: 'Period coming up',
    description: 'A few days before your period is due',
    defaultOn: true,
    priority: 1,
    pausedInPregnancy: true,
  },
  {
    key: 'period_start',
    label: 'Period due today',
    description: 'On the day your period is expected, to log it',
    defaultOn: true,
    priority: 2,
    pausedInPregnancy: true,
  },
  {
    key: 'fertile_window',
    label: 'Fertile window & ovulation',
    description: 'When your fertile window opens and on ovulation day',
    defaultOn: false,
    priority: 2,
    pausedInPregnancy: true,
  },
  {
    key: 'symptom_heads_up',
    label: 'Symptom heads-up',
    description: 'Before the symptoms you usually get around your period',
    defaultOn: true,
    priority: 3,
    pausedInPregnancy: true,
  },
  {
    key: 'phase_tips',
    label: 'Cycle phase tips',
    description: 'A short tip when a new phase of your cycle starts',
    defaultOn: true,
    priority: 4,
    pausedInPregnancy: true,
  },
  {
    key: 'daily_log',
    label: 'Daily log reminder',
    description: 'A nudge on days you haven’t logged anything',
    defaultOn: true,
    priority: 9,
    pausedInPregnancy: false,
  },
];

export const AUTO_NOTIFICATION_KEYS = AUTO_NOTIFICATIONS.map((c) => c.key);
export const MAX_PER_DAY = 2;
/** Default local time for automatic notifications. */
export const DEFAULT_NOTIFICATION_TIME = '09:00';
/** Nothing automatic goes out after this local time, even if the tick ran late. */
export const QUIET_AFTER_MINUTES = 22 * 60;

const byKey = Object.fromEntries(AUTO_NOTIFICATIONS.map((c) => [c.key, c]));

/**
 * Each category's switch for one user. Two predate this file and live in
 * their old CycleSettings fields (the tracker used to set them):
 * period_upcoming = remindersEnabled, fertile_window = ovulationReminder or
 * fertilityReminder. The daily log reminder used to ride on remindersEnabled,
 * so it follows that until the person sets it on its own.
 */
export const resolvePrefs = (settings = {}) => {
  const stored = settings.notificationPrefs || {};
  const read = (key) => (typeof stored[key] === 'boolean' ? stored[key] : undefined);
  const prefs = {};
  for (const c of AUTO_NOTIFICATIONS) prefs[c.key] = read(c.key) ?? c.defaultOn;
  prefs.period_upcoming = settings.remindersEnabled ?? true;
  prefs.fertile_window = Boolean(settings.ovulationReminder || settings.fertilityReminder);
  prefs.daily_log = read('daily_log') ?? settings.remindersEnabled ?? true;
  return prefs;
};

/**
 * The CycleSettings update for a set of switches ({ key: boolean }),
 * written back to the old fields for the two that live there.
 */
export const prefsUpdate = (changes = {}) => {
  const $set = {};
  for (const [key, value] of Object.entries(changes)) {
    if (!byKey[key] || typeof value !== 'boolean') continue;
    if (key === 'period_upcoming') $set.remindersEnabled = value;
    else if (key === 'fertile_window') {
      $set.ovulationReminder = value;
      $set.fertilityReminder = value;
    } else $set[`notificationPrefs.${key}`] = value;
  }
  return $set;
};

const addDaysKey = (key, days) => {
  const d = dateFromDateKey(key);
  d.setUTCDate(d.getUTCDate() + days);
  return dateToDateKey(d);
};
const isoKey = (iso) => (iso ? dateToDateKey(new Date(iso)) : null);

const SYMPTOM_LABELS = {
  cramps: 'Cramps',
  headache: 'Headaches',
  backache: 'Back pain',
  'tender-breasts': 'Tender breasts',
  acne: 'Breakouts',
  fatigue: 'Tiredness',
  cravings: 'Cravings',
  bloated: 'Bloating',
  insomnia: 'Trouble sleeping',
  nausea: 'Nausea',
  'abdominal-pain': 'Tummy pain',
};

/** Days a period started on: the first of each run of flow days. */
export const periodStartKeys = (logs = []) => {
  const flowDays = new Set(
    logs.filter((l) => l?.dateKey && l.flow && l.flow !== 'none').map((l) => l.dateKey),
  );
  return [...flowDays].filter((k) => !flowDays.has(addDaysKey(k, -1))).sort();
};

/**
 * The person's own usual symptom around a period: one they logged within
 * 3 days before to 1 day after the start in at least 2 of their last 3
 * periods. Null without that history, so nobody gets a generic guess.
 */
export const usualPeriodSymptom = (logs = []) => {
  const starts = periodStartKeys(logs).slice(-3);
  if (starts.length < 2) return null;
  const byDay = new Map(logs.filter((l) => l?.dateKey).map((l) => [l.dateKey, l]));
  const cyclesWith = new Map();
  for (const start of starts) {
    const seen = new Set();
    for (let d = -3; d <= 1; d++) {
      const log = byDay.get(addDaysKey(start, d));
      if (!log) continue;
      const tags = [
        ...(log.symptoms || []),
        ...(log.digestions || (log.digestion ? [log.digestion] : [])),
        ...((log.skins || (log.skin ? [log.skin] : [])).includes('acne') ? ['acne'] : []),
      ];
      tags.forEach((t) => SYMPTOM_LABELS[t] && seen.add(t));
    }
    seen.forEach((t) => cyclesWith.set(t, (cyclesWith.get(t) || 0) + 1));
  }
  const best = [...cyclesWith]
    .filter(([, n]) => n >= 2)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best
    ? { key: best[0], label: SYMPTOM_LABELS[best[0]], cycles: best[1], of: starts.length }
    : null;
};

const PHASE_TIPS = {
  follicular: {
    title: 'Energy on the rise',
    body: 'Your period’s done and energy often climbs this week. A good time to try something new or a harder workout.',
  },
  ovulation: {
    title: 'Feeling bright?',
    body: 'Energy and confidence often peak around now. Drink enough water and keep moving.',
  },
  luteal: {
    title: 'Slowing down is okay',
    body: 'Before your period, cravings and low moods are common. Sleep, protein and a short walk can help.',
  },
};

const DAILY_LOG = {
  period: { title: 'How’s your flow today?', body: 'Log it in a tap to keep your dates right.' },
  follicular: {
    title: 'How are you feeling today?',
    body: 'Log your mood or energy. It only takes a few taps.',
  },
  ovulation: {
    title: 'Got a minute for yourself?',
    body: 'Log today and watch your patterns build up.',
  },
  luteal: {
    title: 'Check in with yourself',
    body: 'Logging symptoms now helps Nura spot what comes before your period.',
  },
};

const TRACKER = '/(app)/(dashboard)/tracker';
const LOG_TODAY = (focus) => `/(app)/tracker?log=today${focus ? `&focus=${focus}` : ''}`;

/**
 * What's due for one person on their local today. `guards` holds the last
 * value sent per category (CycleSettings.notificationGuards), so a plan
 * never repeats one; the tick still claims each atomically before sending.
 * Returns at most MAX_PER_DAY items, most important first.
 */
export const planNotifications = ({
  predictions: p,
  logs = [],
  todayKey,
  prefs,
  reminderDaysBefore = 2,
  pregnancyMode = false,
  disabled = new Set(),
  guards = {},
  sentToday = 0,
}) => {
  if (!p || !todayKey) return [];
  const on = (key) =>
    prefs[key] && !disabled.has(key) && !(pregnancyMode && byKey[key].pausedInPregnancy);
  const due = [];
  const add = (key, guard, n) => {
    if (guards[key] === guard) return;
    due.push({ key, guard, priority: byKey[key].priority, ...n });
  };
  const nextKey = p.nextPeriodDateKey;
  const days = p.nextPeriodDaysAway;
  const about = p.confidence === 'high' ? 'on' : 'around';

  if (on('health_alerts')) {
    const startKey = isoKey(p.currentPeriodStartDateISO);
    if (p.noPeriodTooLong) {
      add('health_alerts', `no_period:${startKey}`, {
        type: 'system',
        title: 'It’s been a while since your last period',
        body: 'Going 90 days or more without a period is worth talking over with a gynaecologist.',
        data: { route: '/(app)/consultation', icon: 'medkit' },
      });
    } else if (p.longPeriod && p.actualPeriodStartISO) {
      add('health_alerts', `long:${isoKey(p.actualPeriodStartISO)}`, {
        type: 'system',
        title: `Your last period lasted ${p.lastPeriodDays} days`,
        body: 'Bleeding for more than 7 days is worth checking with a doctor.',
        data: { route: '/(app)/consultation', icon: 'medkit' },
      });
    } else if (p.outsideNormalRange && (p.cyclesAnalyzed ?? 0) >= 3) {
      // At most once a quarter: it describes a pattern, not a single day.
      const quarter = `${todayKey.slice(0, 4)}Q${Math.floor((Number(todayKey.slice(5, 7)) - 1) / 3) + 1}`;
      add('health_alerts', `range:${quarter}`, {
        type: 'system',
        title: 'Your cycles have been outside the usual range',
        body: 'See your cycle lengths, and bring them to a doctor if they keep changing.',
        data: { route: '/(app)/graphs-reports', icon: 'medkit' },
      });
    }
  }

  if (on('period_late') && p.isLate && (p.daysLate === 3 || p.daysLate === 7)) {
    add('period_late', `${nextKey}:${p.daysLate}`, {
      type: 'period_reminder',
      title: p.daysLate === 3 ? 'Your period is 3 days late' : 'Your period is a week late',
      body:
        p.daysLate === 3
          ? 'Stress, sleep and travel can all shift it. If it started, log it so your dates stay right.'
          : 'If there’s a chance you could be pregnant, a home test can help. Log your period when it comes.',
      data: { route: LOG_TODAY('flow'), icon: 'calendar' },
    });
  }

  if (!p.isLate) {
    if (on('period_start') && days === 0) {
      add('period_start', nextKey, {
        type: 'period_reminder',
        title: 'Your period may start today',
        body: 'Log it when it does. One tap keeps your predictions accurate.',
        data: { route: LOG_TODAY('flow'), icon: 'water' },
      });
    }
    if (on('period_upcoming') && reminderDaysBefore > 0 && days === reminderDaysBefore) {
      add('period_upcoming', nextKey, {
        type: 'period_reminder',
        title: days === 1 ? 'Your period is due tomorrow' : `Your period is due in ${days} days`,
        body: `Expected ${about} ${p.nextPeriodDate}. Good time to pack pads or a cup in your bag.`,
        data: { route: TRACKER, icon: 'calendar' },
      });
    }
    const headsUpDay = reminderDaysBefore === 1 ? 2 : 1;
    if (on('symptom_heads_up') && days === headsUpDay) {
      const usual = usualPeriodSymptom(logs);
      if (usual) {
        add('symptom_heads_up', nextKey, {
          type: 'system',
          title: `${usual.label} often show up for you about now`,
          body: `You logged them before ${usual.cycles} of your last ${usual.of} periods. Keep what helps you close by.`,
          data: { route: '/(app)/symptom-predictions', icon: 'heart' },
        });
      }
    }
  }

  if (on('fertile_window') && p.ovulationReliable && !p.isLate) {
    const ovKey = p.ovulationDateKey;
    if (todayKey === isoKey(p.fertileWindowStartISO)) {
      add('fertile_window', `${ovKey}:start`, {
        type: 'ovulation_reminder',
        title: 'Your fertile window starts today',
        body: `Ovulation is expected around ${p.ovulationDate}. These are the likeliest days to get pregnant.`,
        data: { route: TRACKER, icon: 'flower' },
      });
    } else if (todayKey === ovKey) {
      add('fertile_window', `${ovKey}:day`, {
        type: 'ovulation_reminder',
        title: 'Today is your estimated ovulation day',
        body: 'Calendar estimates can be off by a few days, so treat this as a guide.',
        data: { route: TRACKER, icon: 'flower' },
      });
    }
  }

  if (on('phase_tips') && !p.isLate && p.currentCycleDay > 1) {
    const phase = p.currentPhase;
    const before = getCyclePhase(p.currentCycleDay - 1, p.periodLength, p.cycleLength);
    // The fertile-window notification already marks the ovulation phase.
    const covered = phase === 'ovulation' && on('fertile_window') && p.ovulationReliable;
    if (phase !== before && PHASE_TIPS[phase] && !covered) {
      add('phase_tips', `${isoKey(p.currentPeriodStartDateISO)}:${phase}`, {
        type: 'system',
        ...PHASE_TIPS[phase],
        data: { route: '/(app)/era', icon: phase === 'luteal' ? 'moon' : 'sparkles' },
      });
    }
  }

  const room = Math.max(0, MAX_PER_DAY - sentToday);
  const picked = due.sort((a, b) => a.priority - b.priority).slice(0, room);

  if (
    !picked.length &&
    sentToday === 0 &&
    on('daily_log') &&
    !logs.some((l) => l?.dateKey === todayKey) &&
    guards.daily_log !== todayKey
  ) {
    const copy = DAILY_LOG[p.currentPhase] || DAILY_LOG.follicular;
    picked.push({
      key: 'daily_log',
      guard: todayKey,
      priority: byKey.daily_log.priority,
      type: 'system',
      ...copy,
      // kind: the app's older builds route a daily_nudge to the tracker.
      data: {
        route: LOG_TODAY(p.currentPhase === 'period' ? 'flow' : null),
        icon: 'sparkles',
        kind: 'daily_nudge',
      },
    });
  }
  return picked;
};
