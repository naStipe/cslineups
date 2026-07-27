// Shared Cloudflare R2 (S3-compatible) helpers used by every API route that
// used to talk to Supabase Storage. R2 has no per-object RLS the way
// Supabase did, so authorization now happens in the routes that use these
// helpers (checking the caller's Supabase auth JWT + folder ownership)
// before ever minting a URL or touching an object.
//
// Layout:
//  - Public bucket (R2_PUBLIC_BUCKET): official screenshots, bucket-root
//    keys (just the filename), served forever via R2_PUBLIC_BASE_URL with
//    no auth needed. Mirrors the old Supabase "lineup-images" bucket.
//  - Private bucket (R2_PRIVATE_BUCKET): personal screenshots, keyed as
//    `<userId>/<filename>`. Never exposed directly — every read goes
//    through a short-lived presigned GET URL. Mirrors the old Supabase
//    "lineup-images-private" bucket. (This bucket also still holds the
//    original official screenshots at its root, left over from the
//    Supabase->R2 migration — see resplit-public-bucket.js, which copies
//    those out into the public bucket without disturbing the per-user
//    folders here.)
const {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  ListObjectsV2Command,
} = require("@aws-sdk/client-s3");
const { getSignedUrl } = require("@aws-sdk/s3-request-presigner");

function requireEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env var: ${name}`);
  return v;
}

let _client = null;
function client() {
  if (_client) return _client;
  _client = new S3Client({
    endpoint: requireEnv("R2_ENDPOINT"),
    region: "auto",
    credentials: {
      accessKeyId: requireEnv("R2_ACCESS_KEY_ID"),
      secretAccessKey: requireEnv("R2_SECRET_ACCESS_KEY"),
    },
  });
  return _client;
}

const PUBLIC_BUCKET = () => requireEnv("R2_PUBLIC_BUCKET");
const PRIVATE_BUCKET = () => requireEnv("R2_PRIVATE_BUCKET");
const PUBLIC_BASE_URL = () => requireEnv("R2_PUBLIC_BASE_URL").replace(/\/+$/, "");

// Private-bucket objects are keyed as `<userId>/<filename>` — no extra
// prefix (matches the layout the Supabase->R2 migration actually produced:
// personal screenshots landed in a bare per-user folder, official ones at
// the bucket root as plain filenames, with nothing else added on top).
function privateKey(userId, filename) {
  return `${userId}/${filename}`;
}

// Splits a `<userId>/<filename...>` key back into its parts.
// Returns null if the key isn't in that shape.
function parsePrivateKey(key) {
  if (typeof key !== "string") return null;
  const slash = key.indexOf("/");
  if (slash < 0) return null;
  return { userId: key.slice(0, slash), filename: key.slice(slash + 1) };
}

async function presignPut(bucket, key, contentType, expiresIn = 300) {
  const cmd = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
  return getSignedUrl(client(), cmd, { expiresIn });
}

async function presignGet(bucket, key, expiresIn = 3600) {
  const cmd = new GetObjectCommand({ Bucket: bucket, Key: key });
  return getSignedUrl(client(), cmd, { expiresIn });
}

async function copyObject(fromBucket, fromKey, toBucket, toKey) {
  await client().send(new CopyObjectCommand({
    Bucket: toBucket,
    Key: toKey,
    CopySource: `${fromBucket}/${encodeURIComponent(fromKey)}`,
  }));
}

async function deleteObject(bucket, key) {
  await client().send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
}

// Batch delete, chunked to S3/R2's 1000-key-per-request limit.
async function deleteObjects(bucket, keys) {
  for (let i = 0; i < keys.length; i += 1000) {
    const chunk = keys.slice(i, i + 1000);
    if (!chunk.length) continue;
    await client().send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: chunk.map((Key) => ({ Key })) },
    }));
  }
}

// Lists every key under a prefix (paginated).
async function listAllKeys(bucket, prefix) {
  const keys = [];
  let ContinuationToken;
  do {
    const res = await client().send(new ListObjectsV2Command({
      Bucket: bucket, Prefix: prefix, ContinuationToken,
    }));
    for (const obj of res.Contents || []) keys.push(obj.Key);
    ContinuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (ContinuationToken);
  return keys;
}

module.exports = {
  client,
  PUBLIC_BUCKET,
  PRIVATE_BUCKET,
  PUBLIC_BASE_URL,
  privateKey,
  parsePrivateKey,
  presignPut,
  presignGet,
  copyObject,
  deleteObject,
  deleteObjects,
  listAllKeys,
};
