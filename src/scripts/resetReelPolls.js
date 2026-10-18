/**
 * Resets every reel poll: removes all votes and sets each option's count to
 * 0, so polls start fresh (everyone can vote again). Questions and options
 * are kept.
 *
 *   node src/scripts/resetReelPolls.js           # dry run: counts only
 *   node src/scripts/resetReelPolls.js --apply   # clears the votes
 *
 * Uses MONGODB_URI from .env, so check which database that is first.
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import mongoose from 'mongoose';
import Reel from '../models/Reel.js';

const apply = process.argv.includes('--apply');
const WITH_VOTES = { $or: [{ 'votes.0': { $exists: true } }, { 'pollOptions.votes': { $gt: 0 } }] };

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);
try {
  const reels = await Reel.find(WITH_VOTES).select('title votes').lean();
  console.log(
    `${apply ? 'Resetting' : 'Dry run (add --apply to reset)'} on ${mongoose.connection.host}`,
  );
  for (const reel of reels) console.log(`- ${reel.title}: ${reel.votes?.length ?? 0} vote(s)`);
  if (apply && reels.length) {
    const result = await Reel.updateMany(WITH_VOTES, {
      $set: { votes: [], 'pollOptions.$[].votes': 0 },
    });
    console.log(`Reset ${result.modifiedCount} reel poll(s).`);
  }
  if (!reels.length) console.log('No poll votes to reset.');
} finally {
  await mongoose.disconnect();
}
