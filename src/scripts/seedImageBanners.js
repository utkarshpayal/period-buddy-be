/* eslint-disable no-console -- CLI script output */
// Seeds evergreen App CMS banners covering every placement and layout: full
// image heroes, a pop-up, cards with a thumbnail, plain cards and strips.
// Artwork lives in ./banner-images and is uploaded to S3 (cms/banners/) on apply.
//
//   node src/scripts/seedImageBanners.js           # dry run: validates, lists what it would add (reads MONGODB_URI)
//   node src/scripts/seedImageBanners.js --apply   # uploads images, writes to MONGODB_URI
//
// Idempotent: a banner whose title already exists is skipped (and its image not
// uploaded). Every banner goes through the same parseBannerInput() as
// POST /api/cms/banners, and a write bumps AppConfig.version so apps refetch.
import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import AppBanner from '../models/AppBanner.js';
import AppConfig from '../models/AppConfig.js';
import { parseBannerInput } from '../utils/appConfig.js';
import { uploadBufferToS3 } from '../utils/s3.js';

const IMAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'banner-images');
// Placeholder so validation passes on a dry run; replaced by the S3 URL on apply.
const PENDING_URL = 'https://pending.invalid/banner.jpg';

const route = (value) => ({ type: 'route', value });
const everyone = { segment: 'all' };
const signedIn = { segment: 'signed_in' };
const free = { segment: 'free' };

const BANNERS = [
  /* ------------------ Image heroes (3:1, text baked into art) ----------------- */
  {
    image: 'premium_hero.jpg',
    title: 'Nura Premium: your cycle, fully decoded',
    ctaLabel: 'Explore Premium',
    placement: 'home_top',
    layout: 'image',
    action: route('/(app)/subscription'),
    audience: free,
    priority: 60,
  },
  {
    image: 'consult_hero.jpg',
    title: 'Talk to a gynecologist from home',
    subtitle: 'Private video consults with verified doctors. No waiting rooms.',
    ctaLabel: 'Book a consult',
    placement: 'home_top',
    layout: 'image',
    action: route('/(app)/consultation'),
    audience: everyone,
    priority: 55,
  },
  {
    image: 'ai_hero.jpg',
    title: 'Ask Nura AI anything, privately',
    subtitle: 'Cramps, late period, discharge, mood: private answers, no judgement.',
    ctaLabel: 'Start chatting',
    placement: 'home_middle',
    layout: 'image',
    action: route('/(app)/(dashboard)/ai-chat'),
    audience: everyone,
    priority: 30,
  },
  {
    image: 'pcos_hero.jpg',
    title: 'Is it PCOS? Check your symptoms in 2 minutes',
    ctaLabel: 'Check symptoms',
    placement: 'care_hub',
    layout: 'image',
    action: route('/(app)/symptom-checker'),
    audience: everyone,
    priority: 40,
  },
  {
    image: 'forest_hero.jpg',
    title: 'Every log grows your wellness forest',
    ctaLabel: 'Visit my forest',
    placement: 'wellness_hub',
    layout: 'image',
    action: route('/(app)/forest'),
    audience: signedIn,
    priority: 40,
  },
  {
    image: 'schemes_hero.jpg',
    title: 'Government schemes made for you',
    subtitle: 'Free sanitary pads, maternity benefits and more.',
    ctaLabel: 'Find my schemes',
    placement: 'explore_hub',
    layout: 'image',
    action: route('/(app)/government-schemes'),
    audience: everyone,
    priority: 40,
  },

  /* ------------------------- Pop-up (4:5, once per device) ------------------------ */
  {
    image: 'era_popup.jpg',
    title: 'What’s your cycle era?',
    subtitle: 'Discover your phase’s vibe, plus tips to move, eat and feel your best.',
    ctaLabel: 'Find my era',
    placement: 'popup',
    layout: 'image',
    action: route('/(app)/era'),
    audience: everyone,
    priority: 10,
    dismissible: true,
  },

  /* ------------------------------ Cards with thumbnail ----------------------------- */
  {
    image: 'tracker_thumb.jpg',
    title: 'Log today in 10 seconds',
    subtitle: 'Flow, mood and symptoms: every log makes tomorrow’s prediction sharper.',
    ctaLabel: 'Log now',
    placement: 'home_middle',
    action: route('/(app)/(dashboard)/tracker'),
    audience: signedIn,
    priority: 25,
  },
  {
    image: 'hormones_thumb.jpg',
    title: 'Why you feel different every week',
    subtitle: 'See how your hormones shift through your cycle, and what that means for you.',
    ctaLabel: 'See insights',
    placement: 'care_hub',
    action: route('/(app)/insights'),
    audience: signedIn,
    priority: 20,
  },
  {
    image: 'blogs_thumb.jpg',
    title: 'Foods that actually ease cramps',
    subtitle: 'Simple swaps and snacks for your period days, backed by experts.',
    ctaLabel: 'Read now',
    placement: 'explore_hub',
    action: route('/(app)/blogs'),
    audience: everyone,
    priority: 15,
  },
  {
    image: 'badges_thumb.jpg',
    title: 'You’ve got badges waiting',
    subtitle: 'Streaks, first logs and more. See what you’ve unlocked.',
    ctaLabel: 'View badges',
    placement: 'profile',
    action: route('/(app)/badges'),
    audience: signedIn,
    priority: 15,
  },

  /* ---------------------------------- Plain card ---------------------------------- */
  {
    title: 'Crampy? Try a 5-minute stretch',
    subtitle: 'Short videos with gentle moves that help on heavy days.',
    ctaLabel: 'Watch now',
    placement: 'wellness_hub',
    action: route('/(app)/reels'),
    audience: everyone,
    backgroundColor: '#DDF0E2',
    textColor: '#1F5C4A',
    priority: 20,
  },

  /* ------------------------------------- Strips ------------------------------------ */
  {
    title: 'New: tips for your cycle phase ✨',
    ctaLabel: 'See tips',
    placement: 'home_middle',
    layout: 'strip',
    action: route('/(app)/era'),
    audience: everyone,
    backgroundColor: '#EEE6FA',
    textColor: '#5F43A3',
    priority: 10,
    dismissible: true,
  },
  {
    title: 'Period late? See what might be going on',
    ctaLabel: 'Check',
    placement: 'care_hub',
    layout: 'strip',
    action: route('/(app)/symptom-predictions'),
    audience: everyone,
    priority: 10,
  },
  {
    title: 'Period hygiene: the 2-minute guide',
    ctaLabel: 'Read',
    placement: 'wellness_hub',
    layout: 'strip',
    action: route('/(app)/hygiene'),
    audience: everyone,
    backgroundColor: '#FFF6E0',
    textColor: '#7A4E00',
    priority: 10,
  },
  {
    title: 'Share your cycle report with your doctor',
    ctaLabel: 'Open',
    placement: 'profile',
    layout: 'strip',
    action: route('/(app)/graphs-reports'),
    audience: signedIn,
    backgroundColor: '#D3E7F5',
    textColor: '#1F3F5B',
    priority: 12,
  },
];

const apply = process.argv.includes('--apply');

const parsed = BANNERS.map(({ image, ...b }) => {
  const result = parseBannerInput({ ...b, imageUrl: image ? PENDING_URL : null });
  if (result.error) throw new Error(`"${b.title}": ${result.error}`);
  return { image, banner: result.banner };
});
for (const { image } of parsed) if (image) await fs.access(path.join(IMAGE_DIR, image));

await mongoose.connect(process.env.MONGODB_URI);
try {
  const existing = new Set(
    (
      await AppBanner.find(
        { title: { $in: parsed.map((p) => p.banner.title) } },
        { title: 1 },
      ).lean()
    ).map((b) => b.title),
  );
  const toAdd = parsed.filter((p) => !existing.has(p.banner.title));

  console.log(
    `db: ${mongoose.connection.name} — ${toAdd.length} to add, ${existing.size} already exist`,
  );
  for (const { image, banner: b } of toAdd) {
    console.log(
      `  [${b.placement}/${b.layout}] p${b.priority} ${b.audience?.segment ?? 'all'}  ${b.title}  → ${b.action.value}${image ? `  (${image})` : ''}`,
    );
  }

  if (!apply) {
    console.log('\nDry run. Re-run with --apply to upload images and write.');
  } else if (toAdd.length) {
    for (const p of toAdd) {
      if (!p.image) continue;
      const { url } = await uploadBufferToS3({
        buffer: await fs.readFile(path.join(IMAGE_DIR, p.image)),
        mimeType: 'image/jpeg',
        originalName: p.image,
        folder: 'cms/banners',
      });
      p.banner.imageUrl = url;
    }
    await AppBanner.insertMany(toAdd.map((p) => p.banner));
    await AppConfig.updateOne({ key: 'app' }, { $inc: { version: 1 } }, { upsert: true });
    console.log(`\nInserted ${toAdd.length} banners and bumped the app config version.`);
  }
} finally {
  await mongoose.disconnect();
}
