import crypto from 'crypto';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
  HeadBucketCommand,
  CreateBucketCommand,
  PutPublicAccessBlockCommand,
  PutBucketPolicyCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import logger from './logger.js';

let s3Client = null;
const verifiedBuckets = new Set();

const isConfigured = () =>
  Boolean(
    process.env.AWS_REGION &&
    process.env.AWS_S3_BUCKET &&
    process.env.AWS_ACCESS_KEY_ID &&
    process.env.AWS_SECRET_ACCESS_KEY,
  );

const getClient = () => {
  if (!isConfigured()) return null;
  if (!s3Client) {
    s3Client = new S3Client({
      region: process.env.AWS_REGION,
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });
  }
  return s3Client;
};

/**
 * Folders whose objects are meant to be seen by anyone with the link:
 * profile pictures and community media (users/), content media (content/),
 * CMS banners, notification images, company assets and legacy uploads/.
 * Everything else, above all medical-documents/, is private: never covered
 * by the public-read policy and only served through short-lived signed URLs
 * (getSignedViewUrl). Add a folder here only if its files are public by design.
 */
export const PUBLIC_PREFIXES = [
  'users/',
  'content/',
  'cms/',
  'notifications/',
  'company-assets/',
  'uploads/',
];

/** Whether `key` sits in a publicly readable folder. */
export const isPublicKey = (key) => PUBLIC_PREFIXES.some((p) => String(key).startsWith(p));

// Public objects are served back via plain https://bucket.s3.region.amazonaws.com/key
// URLs (no signing), so the bucket must allow anonymous GETs for those folders. New
// (and most existing) buckets default to Block Public Access = on with no
// policy, which is exactly why a successful upload still 403s on view — so
// after confirming the bucket exists we make sure public reads are allowed.
const ensurePublicReadAccess = async (client, bucketName) => {
  try {
    await client.send(
      new PutPublicAccessBlockCommand({
        Bucket: bucketName,
        PublicAccessBlockConfiguration: {
          BlockPublicAcls: false,
          IgnorePublicAcls: false,
          BlockPublicPolicy: false,
          RestrictPublicBuckets: false,
        },
      }),
    );

    const policy = {
      Version: '2012-10-17',
      Statement: [
        {
          // Public folders only. Replacing the old bucket-wide statement
          // here is what makes existing medical documents private on the
          // next upload after deploy (see scripts/applyS3Privacy.js to do it
          // right away).
          Sid: 'PublicReadForPublicFolders',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: PUBLIC_PREFIXES.map((p) => `arn:aws:s3:::${bucketName}/${p}*`),
        },
      ],
    };

    await client.send(
      new PutBucketPolicyCommand({ Bucket: bucketName, Policy: JSON.stringify(policy) }),
    );

    logger.info('s3_bucket_public_read_enabled', {
      action: 's3_bucket_public_read_enabled',
      bucketName,
    });
    return true;
  } catch (error) {
    // Non-fatal — some buckets are managed outside this app (e.g. a shared
    // corporate bucket) and the IAM user here may not be allowed to touch
    // its public-access settings. The upload itself still succeeds; only
    // anonymous viewing of the returned URL would be affected.
    logger.error('s3_bucket_public_read_failed', {
      action: 's3_bucket_public_read_failed',
      bucketName,
      error: error.message,
    });
    return false;
  }
};

const ensureBucketExists = async (client, bucketName) => {
  if (verifiedBuckets.has(bucketName)) return;

  const region = process.env.AWS_REGION;
  try {
    await client.send(new HeadBucketCommand({ Bucket: bucketName }));
    await ensurePublicReadAccess(client, bucketName);
    verifiedBuckets.add(bucketName);
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      logger.info('s3_bucket_not_found_creating', {
        action: 's3_bucket_not_found_creating',
        bucketName,
      });
      const createParams = { Bucket: bucketName };
      if (region && region !== 'us-east-1') {
        createParams.CreateBucketConfiguration = {
          LocationConstraint: region,
        };
      }
      await client.send(new CreateBucketCommand(createParams));
      await ensurePublicReadAccess(client, bucketName);
      verifiedBuckets.add(bucketName);
      logger.info('s3_bucket_created', { action: 's3_bucket_created', bucketName });
    } else {
      logger.error('s3_bucket_check_failed', {
        action: 's3_bucket_check_failed',
        bucketName,
        error: error.message,
      });
      throw error;
    }
  }
};

/**
 * Uploads a buffer to S3 under `folder/` with a random file name and returns
 * `{ url, key }`. `url` is the public URL for a public folder and null for a
 * private one (serve those with getSignedViewUrl). Private objects are
 * encrypted with the KMS key in AWS_S3_KMS_KEY_ID when set, else with S3's
 * own keys (SSE-S3). Throws if AWS env vars aren't configured.
 */
export const uploadBufferToS3 = async ({ buffer, mimeType, originalName, folder = 'uploads' }) => {
  const client = getClient();
  if (!client) {
    throw new Error(
      'S3 is not configured. Set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
    );
  }

  const bucket = process.env.AWS_S3_BUCKET;
  await ensureBucketExists(client, bucket);

  const extension = path.extname(originalName || '') || '';
  const key = `${folder}/${crypto.randomUUID()}${extension}`;

  const isPublic = isPublicKey(key);
  const kmsKeyId = process.env.AWS_S3_KMS_KEY_ID;
  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
      ...(!isPublic &&
        (kmsKeyId
          ? { ServerSideEncryption: 'aws:kms', SSEKMSKeyId: kmsKeyId }
          : { ServerSideEncryption: 'AES256' })),
    }),
  );

  if (!isPublic) {
    logger.info('s3_upload_success', { action: 's3_upload_success', key, private: true });
    return { url: null, key };
  }

  const region = process.env.AWS_REGION;
  const publicUrlBase =
    process.env.AWS_S3_PUBLIC_URL_BASE || `https://${bucket}.s3.${region}.amazonaws.com`;
  const url = `${publicUrlBase.replace(/\/+$/, '')}/${key}`;

  logger.info('s3_upload_success', { action: 's3_upload_success', key });
  return { url, key };
};

/**
 * A short-lived signed GET URL to view a private object (e.g. a medical
 * document) in the app. Ten minutes: long enough to open and scroll it,
 * short enough that a leaked link soon stops working.
 */
export const getSignedViewUrl = async ({ key, expiresIn = 600 }) => {
  const client = getClient();
  if (!client || !key) return null;
  return getSignedUrl(
    client,
    new GetObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }),
    {
      expiresIn,
    },
  );
};

/** Re-apply the bucket policy now (scripts/applyS3Privacy.js). */
export const applyBucketPolicy = async () => {
  const client = getClient();
  if (!client) throw new Error('S3 is not configured.');
  if (!(await ensurePublicReadAccess(client, process.env.AWS_S3_BUCKET))) {
    throw new Error(
      'Could not replace the bucket policy (see the s3_bucket_public_read_failed log).',
    );
  }
};

/**
 * A short-lived signed GET URL that forces the browser to download the
 * object rather than display it. Plain public-object URLs (as returned by
 * uploadBufferToS3) can't do this — S3 rejects `response-content-*` header
 * overrides on anonymous requests ("Request specific response headers
 * cannot be used for anonymous GET requests"); those overrides only work on
 * a signed request, which is what this generates.
 */
export const getSignedDownloadUrl = async ({ key, filename, expiresIn = 300 }) => {
  const client = getClient();
  if (!client) {
    throw new Error(
      'S3 is not configured. Set AWS_REGION, AWS_S3_BUCKET, AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY.',
    );
  }

  // Strip CR/LF and quotes so a crafted title/filename can't inject extra
  // response headers through the Content-Disposition value.
  const safeName = String(filename || 'download').replace(/[\r\n"]/g, '');

  const command = new GetObjectCommand({
    Bucket: process.env.AWS_S3_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${safeName}"`,
  });

  return getSignedUrl(client, command, { expiresIn });
};

export const deleteFromS3 = async (key) => {
  const client = getClient();
  if (!client || !key) return;

  try {
    await client.send(new DeleteObjectCommand({ Bucket: process.env.AWS_S3_BUCKET, Key: key }));
  } catch (error) {
    logger.error('s3_delete_failed', { action: 's3_delete_failed', key, error: error.message });
  }
};

/**
 * Deletes every object under `prefix` (e.g. `medical-documents/<userId>/`).
 * Used by the account purge, so it must never be handed a short or
 * user-supplied prefix — callers build it from a server-side id. Never
 * throws: a storage failure is logged and must not abort the purge.
 */
export const deleteS3Prefix = async (prefix) => {
  const client = getClient();
  if (!client || !prefix || !prefix.endsWith('/') || prefix.split('/').length < 3) return 0;

  let deleted = 0;
  try {
    let ContinuationToken;
    do {
      const page = await client.send(
        new ListObjectsV2Command({
          Bucket: process.env.AWS_S3_BUCKET,
          Prefix: prefix,
          ContinuationToken,
        }),
      );
      const objects = (page.Contents || []).map((item) => ({ Key: item.Key }));
      if (objects.length > 0) {
        await client.send(
          new DeleteObjectsCommand({
            Bucket: process.env.AWS_S3_BUCKET,
            Delete: { Objects: objects, Quiet: true },
          }),
        );
        deleted += objects.length;
      }
      ContinuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
    } while (ContinuationToken);
  } catch (error) {
    logger.error('s3_prefix_delete_failed', {
      action: 's3_prefix_delete_failed',
      prefix,
      error: error.message,
    });
  }
  return deleted;
};

export const isS3Configured = isConfigured;
