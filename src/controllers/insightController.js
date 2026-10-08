import CycleLog from '../models/CycleLog.js';
import { clientToday } from '../utils/apiHelpers.js';
import CycleSettings from '../models/CycleSettings.js';
import { sendResponse } from '../utils/sendResponse.js';
import { HTTP_STATUS } from '../constants/httpStatus.js';
import logger from '../utils/logger.js';
import { computeCyclePredictions } from '../utils/cycle.js';

/* ──────────────────────────────────────────────
   Rule-based template maps (no AI call)
────────────────────────────────────────────── */

const PHASE_TEMPLATES = {
  period: {
    dailySummary:
      "You're in your period phase — your body is shedding the uterine lining. Rest and gentle self-care go a long way today.",
    hormoneExplanation:
      'Estrogen and progesterone are at their lowest levels during your period, which is what triggers menstruation. Lower hormone levels can also explain lower energy and mood dips.',
    exerciseSuggestions: ['Gentle yoga or stretching', 'Short walks', 'Light mobility work'],
    nutritionSuggestions: [
      'Iron-rich foods (leafy greens, lentils) to offset blood loss',
      'Warm, hydrating meals',
      'Limit excess caffeine and salt if you experience bloating',
    ],
    sleepSuggestions: [
      'Aim for extra rest — cramps and lower hormones can disrupt sleep',
      'Use a heating pad before bed to ease cramps',
      'Keep a consistent wind-down routine',
    ],
    wellnessRecommendations: [
      'Use a heating pad for cramps',
      'Track flow and symptoms daily',
      "Be extra kind to yourself — it's okay to slow down",
    ],
  },
  follicular: {
    dailySummary:
      "You're in your follicular phase — rising estrogen is fueling more energy and a lifted mood.",
    hormoneExplanation:
      'Estrogen begins rising as your body prepares an egg for release. This typically brings improved energy, mood, and mental clarity compared to your period.',
    exerciseSuggestions: [
      'Cardio or dance workouts',
      'Strength training',
      'Try a new fitness class',
    ],
    nutritionSuggestions: [
      'Lean proteins to support increasing activity levels',
      'Fresh fruits and vegetables for rising metabolism',
      'Fermented foods to support gut health',
    ],
    sleepSuggestions: [
      'Energy is naturally higher — keep a consistent sleep schedule anyway',
      'Get morning sunlight to reinforce your circadian rhythm',
      'Avoid late caffeine as activity levels rise',
    ],
    wellnessRecommendations: [
      'Good time to start new projects or habits',
      'Channel rising energy into productive goals',
      'Plan demanding tasks for this window',
    ],
  },
  ovulation: {
    dailySummary:
      "You're around ovulation — energy, confidence, and libido are often at their peak this phase.",
    hormoneExplanation:
      'A surge in luteinizing hormone triggers the release of an egg, while estrogen peaks just before. Testosterone also rises slightly, which can boost energy and libido.',
    exerciseSuggestions: [
      'High-intensity workouts',
      'Group sports or classes',
      'Peak-performance training',
    ],
    nutritionSuggestions: [
      'Antioxidant-rich foods (berries, colorful vegetables)',
      'Zinc and magnesium-rich foods (nuts, seeds, whole grains)',
      'Stay well hydrated, especially with more intense exercise',
    ],
    sleepSuggestions: [
      'Some notice a slight body temperature rise — keep your room cool',
      'Maintain consistent sleep/wake times despite higher energy',
      'Wind down screens before bed even on high-energy days',
    ],
    wellnessRecommendations: [
      'Great window for important conversations or presentations',
      'Track cervical mucus or BBT if you are trying to conceive',
      'Socialize — confidence tends to peak now',
    ],
  },
  luteal: {
    dailySummary:
      "You're in your luteal phase — progesterone is rising, which can bring more introspective energy and PMS symptoms.",
    hormoneExplanation:
      'Progesterone rises after ovulation to prepare the uterine lining. If pregnancy does not occur, both estrogen and progesterone drop toward the end of this phase, which is linked to PMS symptoms.',
    exerciseSuggestions: [
      'Moderate cardio',
      'Pilates or yoga',
      'Lower-intensity strength training',
    ],
    nutritionSuggestions: [
      'Complex carbs to help stabilize mood swings',
      'Calcium and magnesium-rich foods to ease PMS symptoms',
      'Limit sugar and caffeine if cravings or irritability spike',
    ],
    sleepSuggestions: [
      'Progesterone can be sedating early on — allow extra rest',
      'Keep a cooler room as body temperature rises slightly',
      'Wind down earlier if PMS affects sleep quality',
    ],
    wellnessRecommendations: [
      'Practice stress management (journaling, meditation) as PMS approaches',
      'Plan lighter social commitments toward the end of this phase',
      'Track mood changes to spot your personal PMS pattern',
    ],
  },
};

const PREGNANCY_TEMPLATE = {
  dailySummary:
    "You're tracking in pregnancy mode — here's a general educational check-in for today.",
  hormoneExplanation:
    'During pregnancy, hCG, estrogen, and progesterone rise significantly to support the pregnancy, which can explain fatigue, nausea, and mood changes.',
  moodInsight:
    'Mood swings are common in pregnancy due to rapidly shifting hormone levels — be gentle with yourself and lean on your support system.',
  energyInsight:
    'Fatigue is common, especially in the first and third trimesters. Prioritize rest whenever your schedule allows.',
  skinInsight:
    'Hormonal shifts can bring on the "pregnancy glow" for some, or increased sensitivity and breakouts for others — stick to gentle, fragrance-free products.',
  exerciseSuggestions: [
    'Prenatal yoga or stretching (with provider approval)',
    'Gentle walks',
    'Pelvic floor exercises',
  ],
  nutritionSuggestions: [
    'Folate, iron, and calcium-rich foods',
    'Small, frequent meals to manage nausea',
    'Stay well hydrated',
  ],
  sleepSuggestions: [
    'Try sleeping on your side with a support pillow',
    'Keep a consistent, earlier bedtime as fatigue increases',
    'Limit fluids close to bedtime to reduce night waking',
  ],
  wellnessRecommendations: [
    'Keep up with your prenatal appointments',
    'Discuss any new or severe symptoms with your provider promptly',
    'Build a rest-friendly daily routine',
  ],
};

const MOOD_INSIGHTS = {
  happy: 'Your logged mood has been positive — a great day to lean into activities you enjoy.',
  calm: "You've been feeling calm — a good state for focus-heavy tasks or mindfulness practice.",
  emotional:
    'Your recent mood logs show more emotional sensitivity — give yourself permission to feel without judgment.',
  tired:
    "You've logged feeling tired recently — consider scaling back non-essential commitments today.",
  sad: "You've noted feeling low recently — small acts of self-care and connecting with someone you trust can help.",
  anxious:
    "You've logged some anxiety recently — grounding techniques like slow breathing may help ease it.",
  irritable:
    "You've noted irritability recently — this often lines up with hormonal shifts, so be patient with yourself.",
  neutral: 'Your mood has been steady lately.',
  energetic: "You've been logging high energy — a good time to tackle bigger goals.",
};

const ENERGY_INSIGHTS = {
  low: 'Your energy has been logged as low — prioritize rest and lighter activity today.',
  medium: 'Your energy has been moderate — a balanced day of activity and rest suits you well.',
  steady: 'Your energy has been steady — a good baseline for maintaining your usual routine.',
  high: "You've been logging high energy — a great window for more demanding workouts or tasks.",
};

const DEFAULT_SKIN_INSIGHT =
  'Skin changes often track with hormone shifts across your cycle — keep a consistent, gentle skincare routine and note any patterns you notice.';

/** GET /api/insights/daily — Rule-based daily personalized insights */
export const getDailyInsights = async (req, res, next) => {
  try {
    const settings = await CycleSettings.findOne({ userId: req.userId });
    const pregnancyMode = Boolean(settings?.pregnancyMode);

    const latestLog = await CycleLog.findOne({ userId: req.userId }).sort({ dateKey: -1 });

    let phase = null;
    let template;

    if (pregnancyMode) {
      template = { ...PREGNANCY_TEMPLATE };
    } else if (settings) {
      // Anchor on the user's actual logged period history, not just the
      // configured lastPeriodStartDate — without this, the phase shown here
      // can drift out of sync with the tracker screen (getPredictions,
      // which does pass logs) whenever a real logged period postdates the
      // originally configured date.
      const logs = await CycleLog.find({ userId: req.userId }).sort({ dateKey: 1 });
      phase = computeCyclePredictions(settings, logs, { today: clientToday(req) }).currentPhase;
      template = { ...(PHASE_TEMPLATES[phase] || PHASE_TEMPLATES.follicular) };
      template.moodInsight = latestLog?.mood
        ? MOOD_INSIGHTS[latestLog.mood] || MOOD_INSIGHTS.neutral
        : 'Log your mood today to get a personalized mood insight.';
      template.energyInsight = latestLog?.energy
        ? ENERGY_INSIGHTS[latestLog.energy] || ENERGY_INSIGHTS.medium
        : 'Log your energy today to get a personalized energy insight.';
      template.skinInsight = DEFAULT_SKIN_INSIGHT;
    } else {
      // No cycle settings yet — generic, phase-agnostic educational fallback.
      template = {
        dailySummary: 'Set up your cycle tracking to unlock phase-specific insights.',
        hormoneExplanation:
          'Once you log your cycle, we can explain what your hormones are likely doing today.',
        moodInsight: 'Log your mood to get a personalized mood insight.',
        energyInsight: 'Log your energy to get a personalized energy insight.',
        skinInsight: DEFAULT_SKIN_INSIGHT,
        exerciseSuggestions: ['Gentle walking', 'Stretching', 'Whatever movement feels good today'],
        nutritionSuggestions: [
          'Balanced meals',
          'Stay hydrated',
          'Whole, minimally processed foods',
        ],
        sleepSuggestions: [
          'Consistent sleep schedule',
          'Wind down screens before bed',
          'A cool, dark room',
        ],
        wellnessRecommendations: [
          'Set up your cycle settings for tailored insights',
          'Log daily to build your history',
          'Practice a moment of mindfulness today',
        ],
      };
    }

    logger.info('daily_insights_fetched', {
      action: 'daily_insights_fetched',
      userId: req.userId,
      phase,
      pregnancyMode,
    });

    return sendResponse(res, HTTP_STATUS.OK, 'Daily insights fetched', {
      phase,
      pregnancyMode,
      dailySummary: template.dailySummary,
      hormoneExplanation: template.hormoneExplanation,
      moodInsight: template.moodInsight,
      energyInsight: template.energyInsight,
      skinInsight: template.skinInsight,
      exerciseSuggestions: template.exerciseSuggestions,
      nutritionSuggestions: template.nutritionSuggestions,
      sleepSuggestions: template.sleepSuggestions,
      wellnessRecommendations: template.wellnessRecommendations,
    });
  } catch (error) {
    logger.error('daily_insights_error', { userId: req.userId, error: error.message });
    next(error);
  }
};
