/**
 * Clears medical-review stamps that no real reviewer gave: content marked
 * `medicallyReviewed` with a hand-typed `reviewedBy` but no `reviewedById`
 * (from before reviews were stamped by the server, e.g. seed Q&As signed
 * "Dr. Sarah Johnson, OBGYN"). Those items then show without the badge until
 * a Content Super Admin reviews them in the Content Studio.
 *
 *   node src/scripts/clearUnverifiedReviews.js           # dry run: counts only
 *   node src/scripts/clearUnverifiedReviews.js --apply   # clears them
 *
 * Uses MONGODB_URI from .env, so check which database that is first.
 * Visibility (published/draft) is never changed.
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import mongoose from 'mongoose';
import Blog from '../models/Blog.js';
import HealthIssue from '../models/HealthIssue.js';
import QuestionAnswer from '../models/QuestionAnswer.js';
import Reel from '../models/Reel.js';
import WellbeingResource from '../models/WellbeingResource.js';

const apply = process.argv.includes('--apply');
const MODELS = { Blog, QuestionAnswer, Reel, HealthIssue, WellbeingResource };
const UNVERIFIED = {
  medicallyReviewed: true,
  $or: [{ reviewedById: { $exists: false } }, { reviewedById: null }],
};

const uri = process.env.MONGODB_URI;
if (!uri) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

await mongoose.connect(uri);
try {
  console.log(
    `${apply ? 'Clearing' : 'Dry run (add --apply to clear)'} on ${mongoose.connection.host}`,
  );
  for (const [name, Model] of Object.entries(MODELS)) {
    const names = await Model.distinct('reviewedBy', UNVERIFIED);
    const count = await Model.countDocuments(UNVERIFIED);
    if (!count) continue;
    console.log(
      `${name}: ${count} item(s) signed ${names.filter(Boolean).join(', ') || '(no name)'}`,
    );
    if (apply) {
      const result = await Model.updateMany(UNVERIFIED, {
        $set: { medicallyReviewed: false },
        $unset: { reviewedBy: 1, reviewedAt: 1 },
      });
      console.log(`  cleared ${result.modifiedCount}`);
    }
  }
} finally {
  await mongoose.disconnect();
}
