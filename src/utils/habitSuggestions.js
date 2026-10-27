// Daily habit suggestions for the app's Habits screen: picked from the
// person's last two weeks of day logs, today's cycle phase and their tracking
// goal. The AI writes them when it may (habitSuggestionsAi.js); the rules
// here are the fallback and also check what the AI sends back. Pure (no DB or
// network) so it can be unit-tested.

export const SUGGESTION_WINDOW_DAYS = 14;
/** Picks shown each day: always this many once she has logged anything. */
export const MAX_SUGGESTIONS = 10;
/** Picks stored per day: the extras step in as she adds or dismisses some. */
export const STORED_SUGGESTIONS = 16;
export const SUGGESTION_TITLE_MAX = 60;
export const SUGGESTION_REASON_MAX = 90;

export const HABIT_CATEGORIES = ['sleep', 'nutrition', 'movement', 'mind', 'care'];

/** Points a suggested habit earns per day, by category. */
export const CATEGORY_POINTS = { sleep: 40, nutrition: 30, movement: 35, mind: 25, care: 25 };

/** Icons the AI may pick from (Ionicons names the app maps); the first is each category's default. */
export const CATEGORY_ICONS = {
  sleep: ['moon-outline', 'bed-outline', 'phone-portrait-outline', 'cafe-outline'],
  nutrition: [
    'water-outline',
    'nutrition-outline',
    'leaf-outline',
    'egg-outline',
    'restaurant-outline',
    'cafe-outline',
  ],
  movement: [
    'walk-outline',
    'body-outline',
    'fitness-outline',
    'bicycle-outline',
    'musical-notes-outline',
  ],
  mind: [
    'leaf-outline',
    'create-outline',
    'happy-outline',
    'musical-notes-outline',
    'people-outline',
  ],
  care: [
    'heart-outline',
    'thermometer-outline',
    'medkit-outline',
    'calendar-outline',
    'sunny-outline',
  ],
};

const LOW_MOODS = new Set([
  'anxious',
  'apathetic',
  'depressed',
  'emotional',
  'guilty',
  'irritable',
  'lowEnergy',
  'moodSwings',
  'sad',
  'selfCritical',
]);

// `why` is the reason shown when a habit tops up the list (not picked from a
// log); `phases` and `goals` rank those top-ups for today.
export const HABIT_CATALOG = {
  sleep: {
    title: 'Sleep 8 Hours',
    icon: 'moon-outline',
    category: 'sleep',
    phases: ['period', 'luteal'],
    why: 'Enough sleep steadies mood, energy and cravings',
  },
  windDown: {
    title: 'No Screens 30 Min Before Bed',
    icon: 'phone-portrait-outline',
    category: 'sleep',
    phases: ['luteal'],
    why: 'A calmer bedtime helps you fall asleep sooner',
  },
  bedtime: {
    title: 'Go to Bed by 11 PM',
    icon: 'bed-outline',
    category: 'sleep',
    phases: [],
    why: 'A steady bedtime keeps your body clock on track',
  },
  caffeine: {
    title: 'Skip Caffeine After 2 PM',
    icon: 'cafe-outline',
    category: 'sleep',
    phases: ['luteal', 'period'],
    why: 'Less late caffeine means calmer sleep and fewer jitters',
  },
  water: {
    title: 'Drink 8 Glasses of Water',
    icon: 'water-outline',
    category: 'nutrition',
    phases: ['ovulation', 'period'],
    why: 'Staying hydrated helps energy, skin and headaches',
  },
  iron: {
    title: 'Eat Iron-Rich Food',
    icon: 'nutrition-outline',
    category: 'nutrition',
    phases: ['period'],
    why: "Iron helps replace what's lost during your period",
  },
  greens: {
    title: 'Eat a Bowl of Leafy Greens',
    icon: 'leaf-outline',
    category: 'nutrition',
    phases: ['period', 'follicular'],
    why: 'Greens bring iron, folate and magnesium',
  },
  fruit: {
    title: 'Eat Two Servings of Fruit',
    icon: 'nutrition-outline',
    category: 'nutrition',
    phases: ['follicular', 'ovulation'],
    why: 'Fruit adds fibre and steady energy',
  },
  fibre: {
    title: 'Add Fibre to a Meal',
    icon: 'leaf-outline',
    category: 'nutrition',
    phases: [],
    why: 'Fibre keeps digestion regular',
  },
  lessSalt: {
    title: 'Go Easy on Salt & Fizzy Drinks',
    icon: 'restaurant-outline',
    category: 'nutrition',
    phases: ['luteal'],
    why: 'Less salt can ease bloating before your period',
  },
  protein: {
    title: 'Protein Snack Instead of Sugar',
    icon: 'egg-outline',
    category: 'nutrition',
    phases: ['luteal'],
    why: 'Steady snacks keep cravings and energy dips down',
  },
  seeds: {
    title: 'Snack on Nuts or Seeds',
    icon: 'nutrition-outline',
    category: 'nutrition',
    phases: ['luteal'],
    why: 'Nuts and seeds bring magnesium, which may ease PMS',
  },
  tea: {
    title: 'Have a Cup of Warm Herbal Tea',
    icon: 'cafe-outline',
    category: 'nutrition',
    phases: ['period', 'luteal'],
    why: 'A warm drink can soothe cramps and bloating',
  },
  heat: {
    title: 'Warm Compress for 15 Minutes',
    icon: 'thermometer-outline',
    category: 'care',
    phases: ['period'],
    why: 'Warmth soothes period cramps',
  },
  padChange: {
    title: 'Change Pad or Tampon Every 4–6 Hours',
    icon: 'heart-outline',
    category: 'care',
    phases: ['period'],
    why: 'Keeps you fresh and lowers infection risk',
  },
  rest: {
    title: 'Rest 20 Minutes Without Your Phone',
    icon: 'heart-outline',
    category: 'care',
    phases: ['period'],
    why: 'Real rest helps your body recover',
  },
  sunlight: {
    title: 'Get 10 Minutes of Morning Sunlight',
    icon: 'sunny-outline',
    category: 'care',
    phases: ['follicular', 'ovulation'],
    why: 'Morning light steadies sleep and lifts mood',
  },
  skin: {
    title: 'Wash Face Before Bed',
    icon: 'sunny-outline',
    category: 'care',
    phases: ['luteal'],
    why: 'A clean face at night helps prevent breakouts',
  },
  folate: {
    title: 'Take Your Folic Acid',
    icon: 'medkit-outline',
    category: 'care',
    phases: [],
    goals: ['achieve_pregnancy'],
    why: 'Folic acid matters when trying to conceive',
  },
  stretch: {
    title: 'Stretch for 10 Minutes',
    icon: 'body-outline',
    category: 'movement',
    phases: ['period', 'luteal'],
    why: 'Gentle stretching eases tension and cramps',
  },
  yoga: {
    title: 'Do 15 Minutes of Gentle Yoga',
    icon: 'body-outline',
    category: 'movement',
    phases: ['period', 'luteal'],
    why: 'Gentle yoga eases cramps and calms the mind',
  },
  walk: {
    title: 'Walk for 20 Minutes',
    icon: 'walk-outline',
    category: 'movement',
    phases: ['follicular', 'luteal'],
    why: 'A brisk walk lifts mood and energy',
  },
  mealWalk: {
    title: 'Take a 10-Minute Walk After a Meal',
    icon: 'walk-outline',
    category: 'movement',
    phases: ['luteal'],
    why: 'A short walk after eating helps digestion',
  },
  strength: {
    title: 'Do 15 Minutes of Strength Training',
    icon: 'fitness-outline',
    category: 'movement',
    phases: ['follicular', 'ovulation'],
    why: 'Energy tends to be higher now: good for building strength',
  },
  dance: {
    title: 'Dance to Three Songs',
    icon: 'musical-notes-outline',
    category: 'movement',
    phases: ['ovulation', 'follicular'],
    why: 'A fun way to move when energy is up',
  },
  pelvicFloor: {
    title: 'Do 5 Minutes of Pelvic Floor Exercises',
    icon: 'fitness-outline',
    category: 'movement',
    phases: [],
    goals: ['achieve_pregnancy'],
    why: 'A strong pelvic floor supports bladder and core',
  },
  breathe: {
    title: '5 Minutes of Deep Breathing',
    icon: 'leaf-outline',
    category: 'mind',
    phases: ['luteal', 'period'],
    why: 'Slow breathing calms stress and PMS tension',
  },
  meditate: {
    title: 'Meditate for 10 Minutes',
    icon: 'happy-outline',
    category: 'mind',
    phases: ['luteal'],
    why: 'A quiet mind helps with mood swings',
  },
  journal: {
    title: 'Write 3 Lines in a Journal',
    icon: 'create-outline',
    category: 'mind',
    phases: ['luteal'],
    why: 'Writing it down helps you spot patterns and let go',
  },
  gratitude: {
    title: "Note 3 Things You're Grateful For",
    icon: 'create-outline',
    category: 'mind',
    phases: ['period', 'luteal'],
    why: 'Gratitude gently lifts low days',
  },
  connect: {
    title: 'Call or Text Someone You Love',
    icon: 'people-outline',
    category: 'mind',
    phases: ['period', 'luteal'],
    why: 'Connection softens hard days',
  },
  music: {
    title: 'Listen to Music You Love for 10 Minutes',
    icon: 'musical-notes-outline',
    category: 'mind',
    phases: ['follicular', 'ovulation'],
    why: 'Music is a quick mood lift',
  },
};

const dayNumber = (dateKey) => {
  const [y, m, d] = String(dateKey).split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
};

/** The logs from the last SUGGESTION_WINDOW_DAYS days up to today, newest first. */
export const recentLogs = (logs, todayKey) => {
  const today = dayNumber(todayKey);
  return (logs || [])
    .filter((log) => {
      if (!log?.dateKey) return false;
      const age = today - dayNumber(log.dateKey);
      return age >= 0 && age < SUGGESTION_WINDOW_DAYS;
    })
    .sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1));
};

const average = (values) =>
  values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;

const listOf = (many, one) => (many?.length ? many : one ? [one] : []);

/** What the recent logs say, counted per day. */
export const readSignals = (logs, todayKey) => {
  const recent = recentLogs(logs, todayKey);
  const symptomDays = {};
  let lowMoodDays = 0;
  let exerciseDays = 0;
  let heavyFlowDays = 0;
  let constipatedDays = 0;
  let bloatedDays = 0;
  let acneDays = 0;
  const sleep = [];
  const water = [];
  const stress = [];

  for (const log of recent) {
    for (const s of new Set(log.symptoms || [])) symptomDays[s] = (symptomDays[s] || 0) + 1;
    if (listOf(log.moods, log.mood).some((m) => LOW_MOODS.has(m))) lowMoodDays += 1;
    if ((log.exercise || []).some((e) => e && e !== 'none' && e !== 'didnt-exercise'))
      exerciseDays += 1;
    if (log.flow === 'heavy') heavyFlowDays += 1;
    const digestions = listOf(log.digestions, log.digestion);
    if (digestions.includes('constipated')) constipatedDays += 1;
    if (digestions.includes('bloated') || log.symptoms?.includes('bloated')) bloatedDays += 1;
    if (listOf(log.skins, log.skin).includes('acne') || log.symptoms?.includes('acne'))
      acneDays += 1;
    if (typeof log.sleepHours === 'number' && log.sleepHours > 0) sleep.push(log.sleepHours);
    if (typeof log.waterIntake === 'number' && log.waterIntake > 0) water.push(log.waterIntake);
    if (typeof log.stressLevel === 'number' && log.stressLevel > 0) stress.push(log.stressLevel);
  }

  return {
    daysLogged: recent.length,
    symptomDays,
    lowMoodDays,
    avgSleep: average(sleep),
    avgWater: average(water),
    avgStress: average(stress),
    exerciseDays,
    heavyFlowDays,
    constipatedDays,
    bloatedDays,
    acneDays,
  };
};

const plural = (n) => (n === 1 ? '1 day' : `${n} days`);

const normTitle = (title) =>
  String(title || '')
    .trim()
    .toLowerCase();

/**
 * Rule-based suggestions, strongest reason first, skipping habits already
 * added: what her logs point to, then topped up to `limit` for today's phase
 * and her goal (`topUp`). With nothing logged lately the list is empty.
 */
export const suggestByRules = ({
  logs,
  todayKey,
  phase,
  goal,
  existingTitles = [],
  avoidTitles = [],
  limit = MAX_SUGGESTIONS,
}) => {
  const s = readSignals(logs, todayKey);
  // Nothing logged: nothing to base a habit on, so no generic filler.
  if (s.daysLogged === 0) return [];
  const sd = s.symptomDays;
  const picks = new Map();
  const add = (key, score, reason) => {
    const current = picks.get(key);
    if (!current || score > current.score) picks.set(key, { score, reason });
  };

  const cramps = (sd.cramps || 0) + (sd['abdominal-pain'] || 0);
  if (cramps >= 2) {
    add('heat', 60 + cramps * 5, `You logged cramps on ${plural(cramps)} lately`);
    add('stretch', 50 + cramps * 4, 'Gentle stretching can ease cramps');
  }
  if ((sd.backache || 0) >= 2)
    add('stretch', 55 + sd.backache * 4, `Backache came up on ${plural(sd.backache)}`);
  if ((sd.headache || 0) >= 2)
    add('water', 55 + sd.headache * 5, `Headaches on ${plural(sd.headache)}: water often helps`);

  const tired = (sd.fatigue || 0) + (sd.insomnia || 0);
  if ((sd.insomnia || 0) >= 2)
    add('windDown', 60 + sd.insomnia * 5, `Trouble sleeping on ${plural(sd.insomnia)}`);
  if (tired >= 2) add('sleep', 55 + tired * 4, `You felt tired on ${plural(tired)} lately`);
  if (s.avgSleep !== null && s.avgSleep < 7) {
    add(
      'sleep',
      70 + Math.round((7 - s.avgSleep) * 8),
      `You've averaged ${s.avgSleep.toFixed(1)} h of sleep`,
    );
    add('windDown', 50, 'A calmer bedtime helps you sleep longer');
  }
  if (s.avgWater !== null && s.avgWater < 2000) {
    add(
      'water',
      70 + Math.round((2000 - s.avgWater) / 100),
      `You've been drinking about ${(s.avgWater / 1000).toFixed(1)} L a day`,
    );
  }

  if ((sd.cravings || 0) >= 2)
    add('protein', 55 + sd.cravings * 4, `Cravings on ${plural(sd.cravings)}`);
  if (s.constipatedDays >= 2)
    add('fibre', 60 + s.constipatedDays * 5, `Constipation on ${plural(s.constipatedDays)}`);
  if (s.bloatedDays >= 2)
    add('lessSalt', 55 + s.bloatedDays * 5, `You felt bloated on ${plural(s.bloatedDays)}`);
  if (s.acneDays >= 2) add('skin', 50 + s.acneDays * 4, `Breakouts on ${plural(s.acneDays)}`);
  if (s.heavyFlowDays >= 2)
    add(
      'iron',
      65 + s.heavyFlowDays * 5,
      `Heavy flow on ${plural(s.heavyFlowDays)}: top up on iron`,
    );

  if (s.avgStress !== null && s.avgStress >= 6) {
    add(
      'breathe',
      65 + Math.round(s.avgStress * 2),
      `Your stress has averaged ${Math.round(s.avgStress)}/10`,
    );
  }
  if (s.lowMoodDays >= 2) {
    add('journal', 55 + s.lowMoodDays * 4, `Low or anxious moods on ${plural(s.lowMoodDays)}`);
    add('walk', 45 + s.lowMoodDays * 3, 'A short walk can lift your mood');
  }
  if (s.daysLogged >= 5 && s.exerciseDays <= 1) {
    add(
      'walk',
      50,
      s.exerciseDays ? 'You moved on only 1 logged day' : 'No exercise logged lately',
    );
  }

  switch (phase) {
    case 'period':
      add('iron', 35, "Your period is on: iron helps replace what's lost");
      add('heat', 30, 'Warmth soothes period discomfort');
      break;
    case 'luteal':
      add('protein', 30, 'Before your period, steady snacks ease cravings');
      add('breathe', 28, 'Calm moments help with PMS');
      break;
    case 'follicular':
      add('walk', 30, 'Energy is rising: a good time to move more');
      break;
    case 'ovulation':
      add('water', 28, 'Stay hydrated around ovulation');
      break;
    default:
      break;
  }

  if (goal === 'achieve_pregnancy') add('folate', 45, 'Folic acid matters when trying to conceive');

  const taken = new Set([...existingTitles, ...avoidTitles].map(normTitle));
  const ranked = [...picks.entries()]
    .sort((a, b) => b[1].score - a[1].score)
    .map(([key, { reason }]) => toSuggestion({ key, ...HABIT_CATALOG[key], reason }));
  const fromLogs = ranked.filter((idea) => !taken.has(normTitle(idea.title))).slice(0, limit);
  // Avoided habits her logs still point to: first back in if the list runs short.
  return topUp(fromLogs, { phase, goal, existingTitles, avoidTitles, limit, backups: ranked });
};

/**
 * Fills the list up to exactly `limit` after the picks so far: catalog habits
 * for today's phase and her goal first, then ones from areas (sleep, food,
 * movement, mind, care) the list doesn't cover yet. Habits she avoided
 * (dismissed or removed lately) are skipped while anything else fits; if the
 * list is still short they may come back, `backups` (avoided ones her logs
 * point to) first. Never a habit she has, never the same habit twice.
 */
export const topUp = (
  picks,
  { phase, goal, existingTitles = [], avoidTitles = [], limit = MAX_SUGGESTIONS, backups = [] },
) => {
  const out = picks.slice(0, limit);
  const has = new Set([...existingTitles, ...out.map((p) => p.title)].map(normTitle));
  const avoided = new Set(avoidTitles.map(normTitle));
  const push = (idea) => {
    has.add(normTitle(idea.title));
    out.push(idea);
  };

  const fill = (allowAvoided) => {
    const candidates = Object.entries(HABIT_CATALOG).filter(
      ([, idea]) =>
        !has.has(normTitle(idea.title)) &&
        (allowAvoided || !avoided.has(normTitle(idea.title))) &&
        (!idea.goals || idea.goals.includes(goal)),
    );
    while (out.length < limit && candidates.length) {
      const covered = new Set(out.map((p) => p.category));
      let best = 0;
      let bestScore = -Infinity;
      candidates.forEach(([, idea], i) => {
        const score =
          (phase && idea.phases.includes(phase) ? 3 : 0) +
          (goal && idea.goals?.includes(goal) ? 2 : 0) +
          (covered.has(idea.category) ? 0 : 1.5) -
          i * 0.001; // catalog order breaks ties
        if (score > bestScore) {
          bestScore = score;
          best = i;
        }
      });
      const [key, idea] = candidates.splice(best, 1)[0];
      push(toSuggestion({ key, ...idea, reason: idea.why }));
    }
  };

  fill(false);
  for (const idea of backups) {
    if (out.length >= limit) break;
    if (!has.has(normTitle(idea.title))) push(idea);
  }
  fill(true);
  return out;
};

const clean = (value, max) =>
  String(value || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max)
    .trim();

const slug = (title) =>
  normTitle(title)
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

/** The stored/sent shape: category, icon and points always valid. */
export const toSuggestion = ({ key, title, icon, category, reason }) => {
  const cat = HABIT_CATEGORIES.includes(category) ? category : 'care';
  const cleanTitle = clean(title, SUGGESTION_TITLE_MAX);
  return {
    key: key || slug(cleanTitle),
    title: cleanTitle,
    icon: CATEGORY_ICONS[cat].includes(icon) ? icon : CATEGORY_ICONS[cat][0],
    category: cat,
    rewardPoints: CATEGORY_POINTS[cat],
    reason: clean(reason, SUGGESTION_REASON_MAX),
  };
};

/**
 * Checks the AI's JSON (`{"habits":[...]}`): drops anything without a title,
 * duplicates and habits already added, and fixes category/icon/points. Returns
 * [] when nothing usable came back.
 */
export const parseAiHabits = (parsed, existingTitles = [], limit = MAX_SUGGESTIONS) => {
  const items = Array.isArray(parsed?.habits) ? parsed.habits : [];
  const seen = new Set(existingTitles.map(normTitle));
  const out = [];
  for (const item of items) {
    if (!item || typeof item !== 'object') continue;
    const suggestion = toSuggestion({
      title: item.title,
      icon: item.icon,
      category: item.category,
      reason: item.reason,
    });
    if (suggestion.title.length < 3 || !suggestion.key) continue;
    const norm = normTitle(suggestion.title);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(suggestion);
    if (out.length >= limit) break;
  }
  return out;
};

/** The day logs as short lines for the AI prompt (no free-text notes). */
export const describeLogs = (logs, todayKey) =>
  recentLogs(logs, todayKey).map((log) => {
    const parts = [log.dateKey];
    if (log.flow && log.flow !== 'none') parts.push(`flow: ${log.flow}`);
    const moods = listOf(log.moods, log.mood);
    if (moods.length) parts.push(`mood: ${moods.join(', ')}`);
    if (log.symptoms?.length) parts.push(`symptoms: ${log.symptoms.join(', ')}`);
    if (log.energy) parts.push(`energy: ${log.energy}`);
    const digestions = listOf(log.digestions, log.digestion);
    if (digestions.length) parts.push(`digestion: ${digestions.join(', ')}`);
    const skins = listOf(log.skins, log.skin);
    if (skins.length) parts.push(`skin: ${skins.join(', ')}`);
    if (log.exercise?.length) parts.push(`exercise: ${log.exercise.join(', ')}`);
    if (typeof log.sleepHours === 'number') parts.push(`sleep: ${log.sleepHours}h`);
    if (typeof log.waterIntake === 'number') parts.push(`water: ${log.waterIntake}ml`);
    if (typeof log.stressLevel === 'number') parts.push(`stress: ${log.stressLevel}/10`);
    return parts.join(', ');
  });

/** How long after a failed AI attempt the day's picks may be made again. */
export const AI_RETRY_AFTER_MS = 30 * 60_000;

/** Whether a stored day whose AI call failed should try the AI again now. */
export const shouldRetryAi = (day, { now = Date.now(), aiOk }) =>
  Boolean(
    day?.aiFailed &&
    aiOk &&
    now - new Date(day.attemptedAt || day.createdAt || 0).getTime() >= AI_RETRY_AFTER_MS,
  );

/** Titles the person dismissed on recent days, from stored suggestion days. */
export const dismissedTitles = (days = []) =>
  days.flatMap((day) => {
    const keys = new Set(day?.dismissed || []);
    const stored = (day?.suggestions || []).filter((s) => keys.has(s.key)).map((s) => s.title);
    // Live top-ups aren't stored, so their keys are catalog ids.
    const live = [...keys].filter((k) => HABIT_CATALOG[k]).map((k) => HABIT_CATALOG[k].title);
    return [...new Set([...stored, ...live])];
  });

/**
 * What to show from a stored day: always exactly MAX_SUGGESTIONS. The stored
 * picks not dismissed and not already a habit come first; if adds and
 * dismissals leave fewer, `topUp` fills the rest live for the day's stored
 * phase and goal (today's dismissals only come back as a last resort).
 */
export const visibleSuggestions = (day, existingTitles = []) => {
  const taken = new Set(existingTitles.map(normTitle));
  const dismissed = new Set(day?.dismissed || []);
  const shown = (day?.suggestions || [])
    .filter((s) => !dismissed.has(s.key) && !taken.has(normTitle(s.title)))
    .slice(0, MAX_SUGGESTIONS);
  if (!day || shown.length >= MAX_SUGGESTIONS) return shown;
  return topUp(shown, {
    phase: day.context?.phase,
    goal: day.context?.goal,
    existingTitles,
    avoidTitles: dismissedTitles([day]),
    limit: MAX_SUGGESTIONS,
  });
};

/** Suggestion keys are slugs or catalog ids. */
export const isSuggestionKey = (key) => typeof key === 'string' && /^[A-Za-z0-9-]{1,60}$/.test(key);

/** Whether there's anything logged in the window to base suggestions on. */
export const hasRecentLogs = (logs, todayKey) => recentLogs(logs, todayKey).length > 0;
