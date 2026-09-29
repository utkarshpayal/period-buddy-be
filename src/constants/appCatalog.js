// What the App CMS (The-Nura-CMS portal) can control in the mobile app, and
// the app's built-in defaults for each. The app ships the same catalog
// (period-buddy's lib/appConfig.ts), so a key only does something once an
// app build knows it: adding a feature here without an app screen behind it
// just shows up in the CMS as a tile the app ignores.
//
// Defaults below mirror what the app shows today, so a fresh database (no
// saved AppConfig) produces exactly the current layout and palette.

/**
 * Where a feature or link tile can live: a hub screen, or the "Shortcuts"
 * block on Home (the `shortcuts` home section) or Profile. Moving a feature
 * between them is just changing its placement.
 */
export const FEATURE_PLACEMENTS = ['care_hub', 'wellness_hub', 'explore_hub', 'home', 'profile'];

/** Theme tokens an admin may tint; used as a feature tile's colour too. */
export const TILE_COLOR_KEYS = [
  'primary',
  'secondary',
  'accent',
  'info',
  'warning',
  'success',
  'gold',
  'sky',
  'rose',
  'lavender',
  'mint',
];

/** large = full-width row, small = half-width grid tile. */
export const FEATURE_SIZES = ['small', 'large'];
// Today's app shows these as full-width rows; everything else is a grid tile.
const LARGE_BY_DEFAULT = new Set(['nuraAi', 'healthConcerns', 'consultation']);

export const FEATURE_CATALOG = [
  // Care & Insights
  {
    key: 'predictions',
    title: 'Predictions',
    description: 'Cycle forecasts & trends',
    icon: 'trending-up-outline',
    route: '/(app)/predictions',
    placement: 'care_hub',
    colorKey: 'primary',
  },
  {
    key: 'insights',
    title: 'Daily Insights',
    description: 'Mood, hormone & energy',
    icon: 'sparkles-outline',
    route: '/(app)/insights',
    placement: 'care_hub',
    colorKey: 'secondary',
  },
  {
    key: 'symptomTrends',
    title: 'Symptom Trends',
    description: 'Likely by cycle phase',
    icon: 'pulse-outline',
    route: '/(app)/symptom-predictions',
    placement: 'care_hub',
    colorKey: 'accent',
  },
  {
    key: 'symptomChecker',
    title: 'Symptom Checker',
    description: 'PCOS, thyroid & more',
    icon: 'clipboard-outline',
    route: '/(app)/symptom-checker',
    placement: 'care_hub',
    colorKey: 'info',
  },
  {
    key: 'graphsReports',
    title: 'Graphs & Reports',
    description: 'Cycle history at a glance',
    icon: 'bar-chart-outline',
    route: '/(app)/graphs-reports',
    placement: 'care_hub',
    colorKey: 'gold',
  },
  {
    key: 'documents',
    title: 'Documents',
    description: 'Reports, prescriptions & chat',
    icon: 'document-text-outline',
    route: '/documents',
    placement: 'care_hub',
    colorKey: 'primary',
  },
  {
    key: 'consultation',
    title: 'Talk to a gynecologist',
    description: 'Private consult, secure chat & video call',
    icon: 'chatbubbles-outline',
    route: '/(app)/consultation',
    placement: 'care_hub',
    colorKey: 'primary',
  },
  // Wellness & Support
  {
    key: 'nuraAi',
    title: 'Nura AI',
    description: 'Ask privately, anytime',
    icon: 'help-circle-outline',
    route: '/(app)/qa',
    placement: 'wellness_hub',
    colorKey: 'info',
  },
  {
    key: 'healthConcerns',
    title: 'Health Concerns',
    description: 'Irregularities & symptoms',
    icon: 'alert-circle-outline',
    route: '/(app)/health-issues',
    placement: 'wellness_hub',
    colorKey: 'warning',
  },
  {
    key: 'hygiene',
    title: 'Hygiene & Care',
    description: 'Product guidance & comfort',
    icon: 'leaf-outline',
    route: '/(app)/hygiene',
    placement: 'wellness_hub',
    colorKey: 'accent',
  },
  {
    key: 'sexualWellbeing',
    title: 'Sexual Wellbeing',
    description: 'Consent, intimacy & safety',
    icon: 'heart-outline',
    route: '/(app)/sexual-wellbeing',
    placement: 'wellness_hub',
    colorKey: 'secondary',
  },
  {
    key: 'checkinCall',
    title: 'Check-in Call',
    description: 'Buddy calls you, hands-free',
    icon: 'call-outline',
    route: '/(app)/checkin-call',
    placement: 'wellness_hub',
    colorKey: 'sky',
  },
  // Explore
  {
    key: 'forest',
    title: 'Forest',
    description: 'Grow your wellness tree',
    icon: 'leaf-outline',
    route: '/(app)/forest',
    placement: 'explore_hub',
    colorKey: 'success',
  },
  {
    key: 'blogs',
    title: 'Blogs',
    description: 'Articles on cycle health',
    icon: 'book-outline',
    route: '/(app)/blogs',
    placement: 'explore_hub',
    colorKey: 'info',
  },
  {
    key: 'videos',
    title: 'Videos',
    description: 'Short videos and reels',
    icon: 'play-circle-outline',
    route: '/(app)/reels',
    placement: 'explore_hub',
    colorKey: 'primary',
  },
  {
    key: 'partnerSync',
    title: 'Partner Sync',
    description: 'Share cycle info & chat',
    icon: 'git-merge-outline',
    route: '/(app)/partner',
    placement: 'explore_hub',
    colorKey: 'accent',
  },
  {
    key: 'habits',
    title: 'Habits',
    description: 'Daily habit tracking',
    icon: 'checkmark-done-outline',
    route: '/(app)/habits',
    placement: 'explore_hub',
    colorKey: 'warning',
  },
  {
    key: 'buddyNomination',
    title: 'Nominate Buddy',
    description: 'Anonymous peer support',
    icon: 'star-outline',
    route: '/(app)/buddy-nomination',
    placement: 'explore_hub',
    colorKey: 'secondary',
  },
  // Gen Z pack — on Home's Shortcuts block by default
  {
    key: 'wrapped',
    title: 'Cycle Wrapped',
    description: 'Your month, story-style',
    icon: 'sparkles',
    route: '/(app)/wrapped',
    placement: 'home',
    colorKey: 'rose',
  },
  {
    key: 'cycleEra',
    title: 'Your Era',
    description: 'Phase vibes & cycle syncing',
    icon: 'planet-outline',
    route: '/(app)/era',
    placement: 'home',
    colorKey: 'lavender',
  },
  {
    key: 'badges',
    title: 'Streaks & Badges',
    description: 'Collect them all',
    icon: 'trophy-outline',
    route: '/(app)/badges',
    placement: 'home',
    colorKey: 'gold',
  },
  {
    key: 'circles',
    title: 'Bestie Circles',
    description: 'Your squad, your vibes',
    icon: 'people-circle-outline',
    route: '/(app)/circles',
    placement: 'home',
    colorKey: 'mint',
  },
].map((f, i) => ({ size: LARGE_BY_DEFAULT.has(f.key) ? 'large' : 'small', ...f, order: i }));

export const FEATURE_KEYS = FEATURE_CATALOG.map((f) => f.key);

/** A block whose heading or text the CMS can override (null = the app's text). */
const heading = (dflt) => ({ label: 'Heading', default: dflt, max: 40 });

/**
 * Home screen blocks, in their default order. `promo_*` are banner slots
 * (banners with placement home_top / home_middle), so ads can be moved
 * around like any other section. `text` marks a block with editable text.
 */
export const HOME_SECTIONS = [
  { key: 'statPills', label: 'Streak & points' },
  { key: 'weekStrip', label: 'Week strip' },
  { key: 'promo_top', label: 'Promo banners (top slot)' },
  { key: 'phaseHero', label: 'Cycle phase card' },
  { key: 'quickActions', label: 'Quick log actions' },
  { key: 'promo_middle', label: 'Promo banners (middle slot)' },
  { key: 'insights', label: 'Insights carousel', text: heading('Insights') },
  { key: 'moreForYou', label: 'More for you (hubs)', text: heading('More for you') },
  { key: 'shortcuts', label: 'Shortcuts (features placed on Home)' },
].map((s, i) => ({ ...s, order: i }));

export const HOME_SECTION_KEYS = HOME_SECTIONS.map((s) => s.key);

const hubSections = (intro) => [
  { key: 'intro', label: 'Intro line', text: { label: 'Text', default: intro, max: 140 } },
  { key: 'promo', label: 'Promo banners' },
  { key: 'tiles', label: 'Feature tiles', required: true },
];

/**
 * Blocks on the other CMS-controlled screens, in their default order (Home
 * keeps HOME_SECTIONS, which older app builds read). `required` blocks can
 * be moved and retitled but not hidden, targeted or scheduled: they hold
 * something a user must always reach (Edit profile, subscription, privacy
 * toggles, log out, the hub itself).
 */
export const SCREEN_SECTIONS = Object.fromEntries(
  Object.entries({
    profile: [
      { key: 'identity', label: 'Photo, name & Edit profile', required: true },
      { key: 'completeProfile', label: 'Complete your profile nudge' },
      { key: 'stats', label: 'Stats (days tracked, points, streak)' },
      { key: 'account', label: 'Your account', required: true, text: heading('Your account') },
      { key: 'preferences', label: 'Preferences', required: true, text: heading('Preferences') },
      {
        key: 'privacyHelp',
        label: 'Privacy & help',
        required: true,
        text: heading('Privacy & help'),
      },
      { key: 'promo', label: 'Promo banners' },
      { key: 'shortcuts', label: 'Shortcuts (features placed on Profile)' },
      { key: 'logout', label: 'Log out', required: true },
    ],
    care_hub: hubSections('Forecasts and insights for your health.'),
    wellness_hub: hubSections(
      'Support for your body and mind — private, judgment-free, and always here.',
    ),
    explore_hub: hubSections('Community, content, and everything to explore beyond tracking.'),
  }).map(([screen, list]) => [screen, list.map((s, i) => ({ required: false, ...s, order: i }))]),
);

/** Screens with an editable title (the hubs), and the app's default. */
export const SCREEN_TITLES = {
  care_hub: 'Care & Insights',
  wellness_hub: 'Wellness & Support',
  explore_hub: 'Explore',
};
export const SCREEN_TITLE_MAX = 30;

export const LAYOUT_SCREENS = Object.keys(SCREEN_SECTIONS);

export const BANNER_PLACEMENTS = [
  'home_top',
  'home_middle',
  'care_hub',
  'wellness_hub',
  'explore_hub',
  'profile',
  // Shown once as a pop-up card when the app opens (per banner, per device).
  'popup',
];
export const BANNER_LAYOUTS = ['card', 'image', 'strip'];
/**
 * What a tap does. route = in-app screen; url = website in the in-app
 * browser; app = another app via its link (e.g. whatsapp://, youtube://),
 * falling back to `fallbackUrl` (usually its store page) when it isn't
 * installed.
 */
export const BANNER_ACTIONS = ['none', 'route', 'url', 'app'];
export const TILE_ACTIONS = ['route', 'url', 'app'];

/**
 * Who sees a tile or banner. Evaluated in the app (it knows the user's
 * plan, platform and version); an older build that doesn't understand a
 * rule shows the item, so rules only ever narrow the audience.
 */
export const AUDIENCE_SEGMENTS = ['all', 'signed_in', 'premium', 'free'];
export const AUDIENCE_PLATFORMS = ['android', 'ios', 'web'];

/** Ionicons names offered for custom link tiles (the app renders Ionicons). */
export const TILE_ICONS = [
  'link-outline',
  'globe-outline',
  'open-outline',
  'logo-whatsapp',
  'logo-youtube',
  'logo-instagram',
  'logo-facebook',
  'logo-twitter',
  'mail-outline',
  'call-outline',
  'chatbubbles-outline',
  'gift-outline',
  'pricetag-outline',
  'cart-outline',
  'storefront-outline',
  'medkit-outline',
  'fitness-outline',
  'nutrition-outline',
  'heart-outline',
  'sparkles-outline',
  'star-outline',
  'book-outline',
  'play-circle-outline',
  'calendar-outline',
  'people-outline',
  'help-circle-outline',
  'information-circle-outline',
  'megaphone-outline',
  'trophy-outline',
  'leaf-outline',
];
export const MAX_CUSTOM_TILES = 30;

/**
 * The app's colour tokens an admin may override, with the app's current
 * values (components/theme.tsx). Anything not overridden keeps the built-in
 * value, and tokens not listed here (danger, overlays, shadows…) are never
 * remote-controlled, so a bad CMS edit can't break error states or
 * contrast-critical UI.
 */
export const THEME_TOKENS = [
  { key: 'primary', label: 'Primary', light: '#E8618F', dark: '#F28FB0' },
  { key: 'primaryDark', label: 'Primary (pressed)', light: '#C94A78', dark: '#E8618F' },
  {
    key: 'primaryLight',
    label: 'Primary tint',
    light: '#F7CADA',
    dark: 'rgba(242, 143, 176, 0.18)',
  },
  { key: 'secondary', label: 'Secondary', light: '#B9A6E0', dark: '#C7B8E8' },
  {
    key: 'secondaryLight',
    label: 'Secondary tint',
    light: '#EEE6FA',
    dark: 'rgba(199, 184, 232, 0.14)',
  },
  { key: 'accent', label: 'Accent', light: '#9FD8C9', dark: '#8FCDBB' },
  { key: 'accentLight', label: 'Accent tint', light: '#DDF0E2', dark: 'rgba(143, 205, 187, 0.14)' },
  { key: 'background', label: 'Background', light: '#F6EEF1', dark: '#221A20' },
  { key: 'surface', label: 'Card surface', light: '#FFFFFF', dark: '#2E2530' },
  { key: 'surfaceSoft', label: 'Soft surface', light: '#FCF5F7', dark: '#3A2C34' },
  { key: 'border', label: 'Border', light: '#E3C6D2', dark: '#3D2E36' },
  { key: 'button', label: 'Button', light: '#E8618F', dark: '#F28FB0' },
  { key: 'buttonText', label: 'Button text', light: '#FFFFFF', dark: '#221A20' },
  { key: 'foreground', label: 'Heading text', light: '#3A2A32', dark: '#F3E8ED' },
  { key: 'text', label: 'Body text', light: '#3A2A32', dark: '#F3E8ED' },
  { key: 'mutedText', label: 'Muted text', light: '#6E5A63', dark: '#B39AA6' },
];

export const THEME_TOKEN_KEYS = THEME_TOKENS.map((t) => t.key);

/** Sections of the config that are saved (and versioned) independently. */
export const CONFIG_SECTIONS = ['features', 'homeSections', 'screenSections', 'theme', 'settings'];

/**
 * App-wide switches. Versions are "major.minor.patch" and compared against
 * the installed app's version (expo `version`).
 */
export const DEFAULT_SETTINGS = {
  maintenance: {
    enabled: false,
    title: 'We’ll be right back',
    message: 'The Nura app is getting an update. Please check back in a little while.',
  },
  update: {
    minVersion: null, // below this: blocking "Update required"
    latestVersion: null, // below this: a dismissible "Update available"
    title: 'A new version is available',
    message: 'Update The Nura to get the latest features and fixes.',
    androidUrl: null,
    iosUrl: null,
  },
};
