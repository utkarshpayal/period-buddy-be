/**
 * Caring Engine for Period Buddy
 * Translates health, cycle, mood, and symptom logs into actionable, caring advice for the partner.
 */

export const generateCareSuggestions = (permissions, cycle, recentLogs) => {
  const suggestions = [];
  const dos = [];
  const donts = [];

  const latestLog = recentLogs && recentLogs.length > 0 ? recentLogs[0] : null;

  // 1. CYCLE PHASE SUGGESTIONS
  if (permissions.shareCyclePhase && cycle) {
    const phase = cycle.currentPhase?.toLowerCase();
    switch (phase) {
      case 'period':
      case 'on her period':
        suggestions.push({
          category: 'Cycle Phase',
          title: 'Period Phase Support',
          message:
            'Her energy may be lower right now as her body sheds its lining. Rest and comfort can help.',
        });
        dos.push(
          'Offer a warm heating pad or hot water bottle for cramps.',
          'Keep her hydrated with warm herbal teas (ginger or chamomile).',
          'Take over extra household chores so she can rest.',
        );
        donts.push(
          'Avoid planning long outings without checking how she feels.',
          'Do not dismiss physical pain or mood shifts.',
        );
        break;

      case 'follicular':
      case 'follicular phase':
        suggestions.push({
          category: 'Cycle Phase',
          title: 'Follicular Phase Support',
          message:
            'Estrogen is rising, and some people feel more energetic and upbeat now. Ask what she is in the mood for.',
        });
        dos.push(
          'Suggest an active or adventurous date night if she is up for it.',
          'Support her in starting new projects or setting goals.',
          'Match her energy if she is feeling upbeat.',
        );
        donts.push('Try not to hold her back or keep things too routine/predictable.');
        break;

      case 'ovulation':
      case 'ovulation phase':
        suggestions.push({
          category: 'Cycle Phase',
          title: 'Ovulation Phase Support',
          message:
            'Some people feel more energetic, confident, and social around ovulation. Check in on how she is feeling.',
        });
        dos.push(
          'Show physical affection and plan romantic dates.',
          'Encourage her social and creative endeavors.',
          'Engage in deep, meaningful conversations.',
        );
        donts.push("Don't assume how she feels — ask what she wants to do.");
        break;

      case 'luteal':
      case 'luteal phase':
        suggestions.push({
          category: 'Cycle Phase',
          title: 'Luteal Phase (PMS Days) Support',
          message:
            'Progesterone rises after ovulation, then drops before her period. Some people feel tired, hungrier, or moodier in these days.',
        });
        dos.push(
          'Offer reassuring words and listen without trying to "fix" everything.',
          'Stock up on comforting healthy snacks or dark chocolate.',
          'Suggest a relaxing walk or a gentle yoga session together.',
        );
        donts.push(
          "Don't take sudden irritability or emotional sensitivity personally.",
          'Avoid crowded, loud, or highly stimulating environments.',
        );
        break;
    }
  }

  // 2. MOOD-BASED SUGGESTIONS
  if (permissions.shareSymptoms && latestLog?.mood) {
    const mood = latestLog.mood.toLowerCase();
    switch (mood) {
      case 'sad':
      case 'emotional':
        suggestions.push({
          category: 'Mood Care',
          title: `Feeling ${latestLog.mood}`,
          message: `She is feeling ${mood} today. A listening ear and physical presence are highly comforting right now.`,
        });
        dos.push(
          'Ask if she wants to talk, or just sit quietly with her.',
          'Offer a comforting hug or hold her hand.',
          'Make her a warm beverage or fetch her favorite blanket.',
        );
        donts.push("Don't minimize her feelings or try to offer logical explanations immediately.");
        break;

      case 'tired':
        suggestions.push({
          category: 'Mood Care',
          title: 'Feeling Tired',
          message:
            'Her body is demanding rest. A little extra support with daily routines goes a long way.',
        });
        dos.push(
          'Encourage her to take a nap or go to bed early.',
          'Prepare a simple, nourishing meal.',
          'Keep the home environment quiet and peaceful.',
        );
        donts.push("Don't ask her to make complex decisions or handle heavy tasks tonight.");
        break;

      case 'anxious':
        suggestions.push({
          category: 'Mood Care',
          title: 'Feeling Anxious',
          message: 'Her nervous system is on alert. Creating safety, calm, and grounding is key.',
        });
        dos.push(
          'Reassure her with calming words of support.',
          'Dim the lights and play soft, soothing music.',
          'Offer to do a 5-minute breathing exercise or meditation together.',
        );
        donts.push('Don\'t say "just relax" or invalidate the anxiety.');
        break;

      case 'irritable':
        suggestions.push({
          category: 'Mood Care',
          title: 'Feeling Irritable',
          message:
            'Fluctuating hormones can make her easily overwhelmed. Giving her space is often the best support.',
        });
        dos.push(
          'Give her quiet space to recharge solo.',
          'Ask gently, "How can I make things easier for you right now?"',
          'Keep your responses calm and patient.',
        );
        donts.push('Avoid arguing, defending, or reacting defensively to minor irritations.');
        break;

      case 'happy':
      case 'energetic':
      case 'calm':
        suggestions.push({
          category: 'Mood Care',
          title: `Feeling ${latestLog.mood}`,
          message: `She is having a good day! Enjoy this time and celebrate her positive energy.`,
        });
        dos.push(
          'Share in her excitement or peaceful mood.',
          'Go for a walk, cook a meal together, or do something fun.',
          'Express appreciation for her presence.',
        );
        break;
    }
  }

  // 3. SYMPTOM-BASED SUGGESTIONS
  if (permissions.shareSymptoms && latestLog?.symptoms && latestLog.symptoms.length > 0) {
    latestLog.symptoms.forEach((symptom) => {
      const sym = symptom.toLowerCase();
      if (sym.includes('cramp')) {
        suggestions.push({
          category: 'Symptom Relief',
          title: 'Cramps Relief',
          message: 'Uterine contractions are causing discomfort. Heat and gentle massage can help.',
        });
        dos.push(
          'Fetch a hot water bottle or heating pad.',
          'Gently massage her lower back if she welcomes it.',
          'Ensure she has access to pain relievers if she uses them.',
        );
        donts.push('Avoid asking her to stand or walk for long periods.');
      } else if (sym.includes('headache') || sym.includes('migraine')) {
        suggestions.push({
          category: 'Symptom Relief',
          title: 'Headache Support',
          message: 'A quiet, dark room can help a headache ease.',
        });
        dos.push(
          'Dim the lights and keep noises low.',
          'Offer a cool, damp washcloth for her forehead.',
          'Bring her a glass of water.',
        );
        donts.push('Limit screen time and bright light exposure in her space.');
      } else if (sym.includes('bloat')) {
        suggestions.push({
          category: 'Symptom Relief',
          title: 'Bloating Relief',
          message: 'Water retention and digestion changes can cause uncomfortable bloating.',
        });
        dos.push(
          'Offer warm peppermint, ginger, or fennel tea.',
          'Suggest a short, slow walk to help digestion.',
          'Cook light, low-sodium meals.',
        );
        donts.push('Avoid serving carbonated drinks or heavy, greasy foods.');
      } else if (sym.includes('fatigue') || sym.includes('exhaust')) {
        suggestions.push({
          category: 'Symptom Relief',
          title: 'Extreme Fatigue',
          message: 'She is running on low fuel. Prioritizing rest is essential.',
        });
        dos.push(
          'Cancel optional evening plans so she can rest.',
          'Ensure her bedding is comfortable and clean.',
        );
      }
    });
  }

  // 4. HEALTH METRIC SUGGESTIONS
  if (permissions.shareSymptoms && latestLog) {
    if (latestLog.stressLevel && latestLog.stressLevel >= 7) {
      suggestions.push({
        category: 'Health Metric',
        title: 'High Stress Alert',
        message: `Her stress is logged at ${latestLog.stressLevel}/10. High stress can affect her cycle and how she feels.`,
      });
      dos.push(
        'Encourage her to step away from work/screens early.',
        'Offer a gentle shoulder rub or draw a warm bath.',
        "Reassure her that she doesn't have to do it all.",
      );
      donts.push('Do not add to her to-do list or request complex task assistance.');
    }
    if (latestLog.sleepHours && latestLog.sleepHours < 6) {
      suggestions.push({
        category: 'Health Metric',
        title: 'Lack of Sleep',
        message: `She slept only ${latestLog.sleepHours} hours last night. A sleep deficit impacts mood and physical recovery.`,
      });
      dos.push(
        'Make her a warm cup of herbal tea or a gentle coffee.',
        'Encourage an early night and minimize noises in the house.',
      );
    }
    if (latestLog.waterIntake && latestLog.waterIntake < 1500) {
      suggestions.push({
        category: 'Health Metric',
        title: 'Hydration Nudge',
        message: `Her water intake is a bit low today (${latestLog.waterIntake}ml). Drinking enough water helps her feel her best.`,
      });
      dos.push(
        'Hand her a glass or bottle of fresh water with lemon or cucumber.',
        'Keep a water pitcher visible and filled.',
      );
    }
  }

  // De-duplicate DOS and DONTS
  const uniqueDos = [...new Set(dos)];
  const uniqueDonts = [...new Set(donts)];

  // If no suggestions, add a default positive one
  if (suggestions.length === 0) {
    suggestions.push({
      category: 'General Care',
      title: 'Be Present',
      message:
        'No specific phase symptoms are active right now. A small random act of kindness is always a wonderful gesture!',
    });
    uniqueDos.push(
      'Surprise her with a small treat, text, or flower.',
      'Ask how her day is going and actively listen.',
    );
    uniqueDonts.push('Do not take her good mood for granted.');
  }

  return {
    suggestions: suggestions.slice(0, 3), // Return top 3 most relevant tips
    dos: uniqueDos.slice(0, 4),
    donts: uniqueDonts.slice(0, 3),
  };
};
