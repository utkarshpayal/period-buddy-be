// Cycle "eras" and the default cycle-syncing tips behind the app's
// Phase Era screen (GET /api/genz/era). Tips are editable from the App CMS
// (CycleSyncTip, /api/cms/cycle-sync-tips): while that collection is empty
// the app gets DEFAULT_CYCLE_SYNC_TIPS below, and once an admin saves any
// tip the database is the only source (so a default can really be removed).

export const CYCLE_SYNC_CATEGORIES = ['move', 'fuel', 'selfCare', 'vibe'];

export const CYCLE_SYNC_CATEGORY_LABELS = {
  move: 'Move',
  fuel: 'Fuel',
  selfCare: 'Self-care',
  vibe: 'Vibe',
};

/** One per phase. `aura` is a two-stop gradient the app paints the era card with. */
export const PHASE_ERAS = {
  period: {
    name: 'Cozy Girl Era',
    emoji: '🧸',
    tagline: 'Rest is productive. Blankets, heating pad, zero guilt.',
    aura: ['#FF6B8B', '#FFB3C1'],
    statusEmoji: '🩸',
  },
  follicular: {
    name: 'Main Character Era',
    emoji: '🌱',
    tagline: 'Feeling fresh? Start the thing, bestie.',
    aura: ['#34C99A', '#A8F0D4'],
    statusEmoji: '🌱',
  },
  ovulation: {
    name: 'It Girl Era',
    emoji: '💅',
    tagline: 'Feeling the glow? Say yes to plans.',
    aura: ['#FFB547', '#FF7A7A'],
    statusEmoji: '✨',
  },
  luteal: {
    name: 'Soft Life Era',
    emoji: '🌙',
    tagline: 'Slow down, snack up, protect your peace.',
    aura: ['#8E7CFF', '#C9B8FF'],
    statusEmoji: '🌙',
  },
};

const tip = (phase, category, emoji, title, body) => ({ phase, category, emoji, title, body });

export const DEFAULT_CYCLE_SYNC_TIPS = [
  // Period
  tip(
    'period',
    'move',
    '🧘',
    'Gentle yoga',
    'Child’s pose and cat-cow can help ease cramps. 10 minutes is plenty.',
  ),
  tip(
    'period',
    'move',
    '🚶',
    'Hot girl stroll',
    'A slow walk gets blood moving without draining you.',
  ),
  tip(
    'period',
    'fuel',
    '🥬',
    'Iron up',
    'Spinach, lentils, beans and ragi help replace what you lose.',
  ),
  tip(
    'period',
    'fuel',
    '🍵',
    'Warm drinks',
    'Ginger or chamomile tea can soothe cramps and bloating.',
  ),
  tip(
    'period',
    'selfCare',
    '🔥',
    'Heat is your bestie',
    'A heating pad on your lower belly can ease cramps.',
  ),
  tip('period', 'selfCare', '😴', 'Sleep in', 'Extra rest is not lazy, it is recovery.'),
  tip(
    'period',
    'vibe',
    '🎬',
    'Comfort watch',
    'Rewatch the show you know by heart. No new plot needed.',
  ),
  // Follicular
  tip(
    'follicular',
    'move',
    '💃',
    'Try a dance class',
    'Some people feel more energetic now. Go learn the choreo.',
  ),
  tip(
    'follicular',
    'move',
    '🏋️',
    'Lift something',
    'Lifting is good for you any week. Feeling strong? Push a little.',
  ),
  tip(
    'follicular',
    'fuel',
    '🥗',
    'Fresh and light',
    'Salads, sprouts and fermented foods like curd or kanji.',
  ),
  tip(
    'follicular',
    'fuel',
    '🥚',
    'Protein it up',
    'Eggs, paneer or dal help you recover from workouts.',
  ),
  tip('follicular', 'selfCare', '📝', 'Plan the month', 'Got new ideas? Write the list.'),
  tip(
    'follicular',
    'vibe',
    '🎧',
    'Main character playlist',
    'Upbeat songs, big plans, sunlight on your face.',
  ),
  // Ovulation
  tip(
    'ovulation',
    'move',
    '🏃',
    'Go for the PR',
    'Feeling energetic? Try HIIT, a run or a sport with friends.',
  ),
  tip(
    'ovulation',
    'fuel',
    '🫐',
    'Colour your plate',
    'Berries, beetroot and greens are great for you any week.',
  ),
  tip('ovulation', 'fuel', '💧', 'Hydrate', 'Keep a bottle nearby, especially on active days.'),
  tip(
    'ovulation',
    'selfCare',
    '📸',
    'Glow check',
    'Some people notice clearer skin now. SPF is always a good idea.',
  ),
  tip(
    'ovulation',
    'vibe',
    '🗣️',
    'Say the brave thing',
    'Feeling confident? Pitch it, ask them, post it.',
  ),
  // Luteal
  tip(
    'luteal',
    'move',
    '🚴',
    'Steady cardio',
    'Feeling heavy? Cycling, swimming or pilates might feel better than HIIT.',
  ),
  tip(
    'luteal',
    'move',
    '🧘',
    'Stretch it out',
    'Longer cool-downs can feel good if you feel heavy before your period.',
  ),
  tip(
    'luteal',
    'fuel',
    '🍫',
    'Dark chocolate, guilt-free',
    'Some people feel hungrier before their period. A few squares can hit the spot.',
  ),
  tip(
    'luteal',
    'fuel',
    '🍠',
    'Complex carbs',
    'Sweet potato, oats and brown rice keep you full for longer.',
  ),
  tip(
    'luteal',
    'selfCare',
    '🛁',
    'Everything shower',
    'Scrub, mask, moisturise. You deserve the full routine.',
  ),
  tip(
    'luteal',
    'selfCare',
    '📵',
    'Screen curfew',
    'Sleep can feel lighter before your period. Phone down an hour before bed.',
  ),
  tip(
    'luteal',
    'vibe',
    '🕯️',
    'Protect your peace',
    'It is okay to cancel plans. Low-key nights are valid.',
  ),
].map((t, i) => ({ ...t, order: i, active: true }));
