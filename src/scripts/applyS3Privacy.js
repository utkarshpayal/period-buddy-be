/**
 * Make private S3 folders private right away, instead of waiting for the
 * first upload after deploy (utils/s3.js rewrites the bucket policy then).
 *
 *   node src/scripts/applyS3Privacy.js            # dry run: what would change
 *   node src/scripts/applyS3Privacy.js --apply    # replace the bucket policy
 *
 * The dry run lists every top-level folder in the bucket and whether it stays
 * public (PUBLIC_PREFIXES) or becomes private. Check it first: a folder that
 * should be public but isn't listed (an old banner folder, say) would start
 * returning 403 to the app. Add it to PUBLIC_PREFIXES before applying.
 *
 * After applying, the old permanent links to medical documents stop working;
 * the app gets signed links from the API instead.
 */
/* eslint-disable no-console -- this is a CLI script; console output is the UX */
import 'dotenv/config';
import { ListObjectsV2Command, S3Client } from '@aws-sdk/client-s3';
import { PUBLIC_PREFIXES, applyBucketPolicy } from '../utils/s3.js';

const apply = process.argv.includes('--apply');
const bucket = process.env.AWS_S3_BUCKET;
if (!bucket || !process.env.AWS_REGION) {
  console.error('Set AWS_REGION and AWS_S3_BUCKET (and credentials) first.');
  process.exit(1);
}

const client = new S3Client({ region: process.env.AWS_REGION });
const folders = [];
let token;
do {
  const page = await client.send(
    new ListObjectsV2Command({ Bucket: bucket, Delimiter: '/', ContinuationToken: token }),
  );
  folders.push(...(page.CommonPrefixes ?? []).map((p) => p.Prefix));
  const loose = (page.Contents ?? []).length;
  if (loose) folders.push(`(${loose} object(s) at the bucket root)`);
  token = page.NextContinuationToken;
} while (token);

console.log(`Bucket ${bucket}:`);
for (const f of folders) {
  const pub = PUBLIC_PREFIXES.some((p) => f === p || f.startsWith(p));
  console.log(`  ${pub ? 'public ' : 'PRIVATE'}  ${f}`);
}

if (!apply) {
  console.log('\nDry run. Re-run with --apply to replace the bucket policy.');
  process.exit(0);
}
await applyBucketPolicy();
console.log(
  '\nBucket policy replaced: only the public folders above are readable without a signed link.',
);
