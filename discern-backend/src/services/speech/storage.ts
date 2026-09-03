// S3. Audio blobs live here and NOWHERE ELSE.
//
// ARCHITECTURE.md §4, storage split: "Mongo stores the S3 key, never the blob."
// A few hundred KB of MP3 per reply would bloat documents that are read on
// every turn, and Atlas storage is the most expensive place to keep bytes
// nobody queries.
//
// Same pattern as Corner's corner-documents bucket: a scoped IAM user with
// rights to this bucket only, credentials from env, no ACLs. Reads go out as
// short-lived presigned URLs rather than public objects, because a user's own
// voice recording is in here alongside the scripture.

import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { voiceConfig } from "../../config/env";

/** Long enough to fetch and play, short enough that a leaked URL is worthless. */
const PRESIGN_TTL_SECONDS = 60 * 60;

let client: S3Client | null = null;

function s3(): S3Client {
  const config = voiceConfig();
  return (client ??= new S3Client({
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  }));
}

/**
 * Keys are prefixed by kind, which is what makes a lifecycle rule possible
 * later: cached scripture is worth keeping forever, a user's raw voice
 * recording is not.
 */
export function speechKey(kind: "tts" | "upload", hash: string): string {
  return `${kind}/${hash.slice(0, 2)}/${hash}.mp3`;
}

export async function putAudio(
  key: string,
  body: Uint8Array,
  contentType = "audio/mpeg",
): Promise<void> {
  await s3().send(
    new PutObjectCommand({
      Bucket: voiceConfig().bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      // Immutable by construction: the key is a hash of the content that made
      // it, so anything under this key can be cached forever by anyone.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
}

/** A short-lived URL a client can play. The bucket itself stays private. */
export async function audioUrl(key: string): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: voiceConfig().bucket, Key: key }),
    { expiresIn: PRESIGN_TTL_SECONDS },
  );
}
