import crypto from 'crypto';
import path from 'path';
import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  DeleteObjectCommand,
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

// Objects are served back via plain https://bucket.s3.region.amazonaws.com/key
// URLs (no signing), so the bucket must actually allow anonymous GETs. New
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
          Sid: 'PublicReadForUploadedObjects',
          Effect: 'Allow',
          Principal: '*',
          Action: 's3:GetObject',
          Resource: `arn:aws:s3:::${bucketName}/*`,
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
 * its public URL. Throws if AWS env vars aren't configured.
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

  await client.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: mimeType,
    }),
  );

  const region = process.env.AWS_REGION;
  const publicUrlBase =
    process.env.AWS_S3_PUBLIC_URL_BASE || `https://${bucket}.s3.${region}.amazonaws.com`;
  const url = `${publicUrlBase.replace(/\/+$/, '')}/${key}`;

  logger.info('s3_upload_success', { action: 's3_upload_success', key });
  return { url, key };
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

export const isS3Configured = isConfigured;
