/**
 * Adds a few YouTube reels (Blender open movies, free to embed) for testing
 * the reels screen: swiping, auto-advance, polls, likes and comments.
 *
 *   node src/scripts/seedTestReels.js                    # dry run
 *   node src/scripts/seedTestReels.js --apply            # add them (skips ones already there)
 *   node src/scripts/seedTestReels.js --remove [--apply] # delete exactly these
 *
 * Every reel is tagged TEST_TAG so --remove only touches what this script
 * added. They show to everyone using this database, so check MONGODB_URI
 * first and remove them when done.
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import mongoose from 'mongoose';
import Reel from '../models/Reel.js';

const TEST_TAG = 'test-reel';
const CREATOR_ID = 'pb_creator_admin';

const poll = (question, topics) => ({
  pollQuestion: question,
  pollOptions: topics.map((topic, index) => ({ optionId: `opt_${index + 1}`, topic, votes: 0 })),
});

const TEST_REELS = [
  {
    youtubeId: 'aqz-KE-bpKQ',
    title: 'Test reel: Big Buck Bunny',
    description: 'Test video for the reels screen.',
    category: 'Wellness',
    ...poll('Test poll: what should the next video cover?', ['Cramps', 'PMS', 'Cycle tracking']),
  },
  {
    youtubeId: 'eRsGyueVLvQ',
    title: 'Test reel: Sintel',
    description: 'Test video for the reels screen.',
    category: 'Nutrition',
  },
  {
    youtubeId: 'R6MlUcmOul8',
    title: 'Test reel: Tears of Steel',
    description: 'Test video for the reels screen.',
    category: 'Fitness',
    ...poll('Test poll: pick one', ['Yoga', 'Walking', 'Stretching', 'Rest']),
  },
  {
    youtubeId: 'WhWc3b3KhnY',
    title: 'Test reel: Spring',
    description: 'Test video for the reels screen.',
    category: 'Mental Health',
  },
  {
    youtubeId: 'YE7VzlLtp-4',
    title: 'Test reel: Big Buck Bunny (short)',
    description: 'Test video for the reels screen.',
    category: 'Wellness',
    ...poll('Test poll: did this load quickly?', ['Yes', 'No']),
  },
];

const apply = process.argv.includes('--apply');
const remove = process.argv.includes('--remove');

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);
try {
  console.log(
    `${apply ? 'Applying' : 'Dry run (add --apply to write)'} on ${mongoose.connection.host}/${mongoose.connection.name}`,
  );

  if (remove) {
    const existing = await Reel.find({ tags: TEST_TAG }).select('title').lean();
    for (const reel of existing) console.log(`- remove: ${reel.title}`);
    if (apply && existing.length) {
      const result = await Reel.deleteMany({ tags: TEST_TAG });
      console.log(`Removed ${result.deletedCount} test reel(s).`);
    }
    if (!existing.length) console.log('No test reels to remove.');
  } else {
    const urls = TEST_REELS.map((reel) => `https://www.youtube.com/watch?v=${reel.youtubeId}`);
    const already = new Set(
      (
        await Reel.find({ directMp4Url: { $in: urls } })
          .select('directMp4Url')
          .lean()
      ).map((reel) => reel.directMp4Url),
    );
    // Spread a minute apart, newest first, so they sit at the top of the feed in this order.
    const now = Date.now();
    const docs = TEST_REELS.map(({ youtubeId, ...rest }, index) => ({
      ...rest,
      tags: [TEST_TAG],
      creatorId: CREATOR_ID,
      directMp4Url: `https://www.youtube.com/watch?v=${youtubeId}`,
      thumbnailUrl: `https://i.ytimg.com/vi/${youtubeId}/hqdefault.jpg`,
      publishedAt: new Date(now - index * 60_000),
    })).filter((doc) => !already.has(doc.directMp4Url));

    for (const url of already) console.log(`- skip (already there): ${url}`);
    for (const doc of docs) console.log(`- add: ${doc.title} (${doc.directMp4Url})`);
    if (apply && docs.length) {
      await Reel.insertMany(docs);
      console.log(`Added ${docs.length} test reel(s).`);
    }
    if (!docs.length) console.log('Nothing to add.');
  }
} finally {
  await mongoose.disconnect();
}
