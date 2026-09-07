/**
 * @netlify/blobs compat shim
 *
 * Replaces Netlify Blob Storage with an S3-compatible backend (AWS S3,
 * Cloudflare R2, or MinIO).
 *
 * Required env vars:
 *   BLOB_ENDPOINT   — S3 endpoint URL (e.g. https://s3.amazonaws.com or
 *                     http://minio:9000 for local dev)
 *   BLOB_REGION     — AWS/R2 region (e.g. us-east-1)
 *   BLOB_ACCESS_KEY — Access key ID
 *   BLOB_SECRET_KEY — Secret access key
 *   BLOB_BUCKET     — Bucket name (default: "halo-blobs")
 *
 * The shim surfaces the same minimal API used across all Netlify Functions:
 *   const store = getStore(name)
 *   await store.get(key, { type: "arrayBuffer" | "stream" | "text" })
 *   await store.set(key, value, { metadata? })
 *   await store.delete(key)
 *   await store.getMetadata(key)
 */

import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3";

let _client = null;

function getClient() {
  if (!_client) {
    _client = new S3Client({
      endpoint: process.env.BLOB_ENDPOINT,
      region: process.env.BLOB_REGION || "us-east-1",
      credentials: {
        accessKeyId: process.env.BLOB_ACCESS_KEY || "",
        secretAccessKey: process.env.BLOB_SECRET_KEY || "",
      },
      forcePathStyle: true, // required for MinIO / non-AWS endpoints
    });
  }
  return _client;
}

const BUCKET = () => process.env.BLOB_BUCKET || "halo-blobs";

async function streamToBuffer(stream) {
  const chunks = [];
  for await (const chunk of stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export function getStore(storeName) {
  const prefix = storeName ? `${storeName}/` : "";
  const client = getClient();
  const bucket = BUCKET();

  return {
    async get(key, options = {}) {
      try {
        const command = new GetObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${key}`,
        });
        const response = await client.send(command);
        const type = options.type || "text";
        if (type === "stream") return response.Body;
        const buf = await streamToBuffer(response.Body);
        if (type === "arrayBuffer") return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
        return buf.toString("utf8");
      } catch (err) {
        if (err.name === "NoSuchKey" || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },

    async set(key, value, options = {}) {
      const body =
        typeof value === "string"
          ? Buffer.from(value, "utf8")
          : Buffer.isBuffer(value)
          ? value
          : Buffer.from(value);

      const command = new PutObjectCommand({
        Bucket: bucket,
        Key: `${prefix}${key}`,
        Body: body,
        ContentType: options.contentType || "application/octet-stream",
        Metadata: options.metadata
          ? Object.fromEntries(
              Object.entries(options.metadata).map(([k, v]) => [k, String(v)])
            )
          : undefined,
      });
      await client.send(command);
    },

    async delete(key) {
      const command = new DeleteObjectCommand({
        Bucket: bucket,
        Key: `${prefix}${key}`,
      });
      await client.send(command);
    },

    async getMetadata(key) {
      try {
        const command = new HeadObjectCommand({
          Bucket: bucket,
          Key: `${prefix}${key}`,
        });
        const response = await client.send(command);
        return {
          metadata: response.Metadata || {},
          etag: response.ETag,
          size: response.ContentLength,
          lastModified: response.LastModified,
        };
      } catch (err) {
        if (err.name === "NotFound" || err.$metadata?.httpStatusCode === 404) return null;
        throw err;
      }
    },
  };
}
