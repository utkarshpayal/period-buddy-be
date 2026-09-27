/* eslint-disable no-console -- CLI script output */
// Adds the four idea-test teaser tiles from The-Nura-CMS docs/idea-tests.md:
// Coming soon link tiles with no tap action and Notify me on, so the app can
// measure demand before anything is built.
//
//   node src/scripts/seedIdeaTests.js           # dry run: validates, lists what it would add
//   node src/scripts/seedIdeaTests.js --apply   # writes to MONGODB_URI
//
// Idempotent: a link tile whose title already exists is skipped. Tiles go
// through the same parseCustomTiles() / parseLaunch() as PUT /api/cms/features
// and are published with saveSection(), so the change bumps the config
// version (apps refetch) and shows in the CMS History like any publish.
import 'dotenv/config';
import mongoose from 'mongoose';
import AppConfig from '../models/AppConfig.js';
import { CONFIG_KEY, saveSection } from '../utils/appConfigStore.js';
import { mergeFeatures, parseCustomTiles } from '../utils/appConfig.js';
import { liveTeaserError, parseLaunch } from '../utils/launch.js';
import { MAX_CUSTOM_TILES } from '../constants/appCatalog.js';

const teaser = (message) => ({
  state: 'coming_soon',
  soon: { headline: 'soon', message, notifyMe: true, goLiveAt: null },
  testers: [],
});

export const IDEA_TILES = [
  {
    title: 'PCOS Care Programme',
    description: 'Doctor-led plan for irregular cycles',
    icon: 'medkit-outline',
    colorKey: 'rose',
    placement: 'care_hub',
    size: 'large',
    launch: teaser(
      'A 12-week plan with a gynaecologist, diet and movement tips, and check-ins that fit your cycle. Want in first?',
    ),
  },
  {
    title: 'Pregnancy Mode',
    description: 'Week-by-week, when you’re ready',
    icon: 'heart-outline',
    colorKey: 'lavender',
    placement: 'home',
    size: 'small',
    launch: teaser(
      'Trying to conceive or expecting? Fertile-window planning, then week-by-week guidance, all in Nura.',
    ),
  },
  {
    title: 'Period Box',
    description: 'Pads, cups & care, delivered monthly',
    icon: 'gift-outline',
    colorKey: 'mint',
    placement: 'explore_hub',
    size: 'small',
    launch: teaser(
      'Your favourite period products delivered before your period starts, timed by your cycle.',
    ),
  },
  {
    title: 'Teen Mode',
    description: 'A gentle first-period guide + parent sharing',
    icon: 'people-outline',
    colorKey: 'sky',
    placement: 'profile',
    size: 'small',
    launch: teaser(
      'Simple guidance for a first period, with an optional, private link for a parent or guardian.',
    ),
  },
];

const apply = process.argv.includes('--apply');

await mongoose.connect(process.env.MONGODB_URI);
try {
  const config = await AppConfig.findOne({ key: CONFIG_KEY }).lean();
  const existing = config?.customTiles ?? [];
  const titles = new Set(existing.map((t) => t.title));
  const toAdd = IDEA_TILES.filter((t) => !titles.has(t.title));
  console.log(
    `db: ${mongoose.connection.name} — ${toAdd.length} to add, ${IDEA_TILES.length - toAdd.length} already exist`,
  );
  if (!toAdd.length) process.exit(0);
  if (existing.length + toAdd.length > MAX_CUSTOM_TILES) {
    throw new Error(`That would be more than ${MAX_CUSTOM_TILES} link tiles`);
  }

  // Each goes last in its placement, after built-in features and other tiles.
  const lastOrder = (placement) =>
    Math.max(
      -1,
      // Merged, so built-ins never saved from the CMS still count at their default order.
      ...mergeFeatures(config?.features)
        .filter((f) => f.placement === placement)
        .map((f) => f.order),
      ...existing.filter((t) => t.placement === placement).map((t) => t.order),
    );
  const nextOrder = {};
  const raw = toAdd.map((t) => {
    nextOrder[t.placement] = (nextOrder[t.placement] ?? lastOrder(t.placement)) + 1;
    return {
      ...t,
      order: Math.min(nextOrder[t.placement], 999),
      enabled: true,
      badge: null,
      action: { type: 'none' },
    };
  });
  const parsed = parseCustomTiles(raw);
  if (parsed.error) throw new Error(parsed.error);
  for (let i = 0; i < parsed.tiles.length; i += 1) {
    const launch = parseLaunch(raw[i].launch, null);
    if (launch.error) throw new Error(`${raw[i].title}: ${launch.error}`);
    parsed.tiles[i].launch = launch.launch;
  }
  const teaserError = liveTeaserError(parsed.tiles);
  if (teaserError) throw new Error(teaserError);

  for (const t of parsed.tiles) {
    console.log(`  + ${t.title} → ${t.placement} (${t.size}), Coming soon, Notify me on`);
  }
  if (!apply) {
    console.log('Dry run: nothing written. Re-run with --apply to publish.');
    process.exit(0);
  }

  const saved = await saveSection(
    'features',
    { features: config?.features ?? [], customTiles: [...existing, ...parsed.tiles] },
    null,
    {
      expected: config?.sectionVersions?.features ?? 0,
      note: `Idea tests: added ${parsed.tiles.map((t) => t.title).join(', ')}`,
    },
  );
  if (saved.conflict) throw new Error('Someone published features meanwhile. Run it again.');
  console.log(`Published (config version ${saved.config.version}).`);
} finally {
  await mongoose.disconnect();
}
