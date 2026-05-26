/**
 * Thin AWS SDK v3 wrapper.
 *
 * One adapter per StorageBackend. The rest of the codebase only imports
 * createS3Adapter and the returned S3Adapter interface — never @aws-sdk/client-s3
 * directly. Keeps the SDK swappable and tests easy.
 */

import {
  S3Client,
  PutObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  ListObjectsV2Command,
} from '@aws-sdk/client-s3';
import type { Readable } from 'node:stream';
import type { StorageBackend } from '../types';

export interface PutObjectInput {
  key: string;
  body: Buffer | Uint8Array | Readable;
  contentType: string;
  cacheControl?: string;
  metadata?: Record<string, string>;
}

export interface GetObjectStreamResult {
  body: Readable;
  contentType: string | undefined;
  contentLength: number | undefined;
}

export interface S3Adapter {
  putObject(input: PutObjectInput): Promise<void>;
  getObjectStream(key: string): Promise<GetObjectStreamResult>;
  headObject(key: string): Promise<{ contentType?: string; contentLength?: number } | null>;
  deleteObject(key: string): Promise<void>;
  listObjectKeys(prefix: string): Promise<string[]>;
}

export function createS3Adapter(backend: StorageBackend): S3Adapter {
  const client = new S3Client({
    endpoint: backend.endpoint,
    region: backend.region,
    credentials: { accessKeyId: backend.accessKey, secretAccessKey: backend.secretKey },
    forcePathStyle: backend.forcePathStyle,
  });

  // Exposed for tests; not part of the public interface. We deliberately
  // reference client.send so test mocks of the SDK can replace it.
  const _send = (client as unknown as { send: (c: unknown) => Promise<unknown> }).send;

  const adapter: S3Adapter & { _send: typeof _send } = {
    _send,
    async putObject({ key, body, contentType, cacheControl, metadata }) {
      await _send(new PutObjectCommand({
        Bucket: backend.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        CacheControl: cacheControl,
        Metadata: metadata,
      }));
    },
    async getObjectStream(key) {
      const res = await _send(new GetObjectCommand({ Bucket: backend.bucket, Key: key })) as {
        Body: Readable; ContentType?: string; ContentLength?: number;
      };
      return { body: res.Body, contentType: res.ContentType, contentLength: res.ContentLength };
    },
    async headObject(key) {
      try {
        const res = await _send(new HeadObjectCommand({ Bucket: backend.bucket, Key: key })) as {
          ContentType?: string; ContentLength?: number;
        };
        return { contentType: res.ContentType, contentLength: res.ContentLength };
      } catch (err: unknown) {
        const e = err as { $metadata?: { httpStatusCode?: number }; name?: string };
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === 'NotFound') return null;
        throw err;
      }
    },
    async deleteObject(key) {
      await _send(new DeleteObjectCommand({ Bucket: backend.bucket, Key: key }));
    },
    async listObjectKeys(prefix) {
      const out: string[] = [];
      let token: string | undefined;
      do {
        const res = await _send(new ListObjectsV2Command({
          Bucket: backend.bucket, Prefix: prefix, ContinuationToken: token,
        })) as { Contents?: Array<{ Key?: string }>; IsTruncated?: boolean; NextContinuationToken?: string };
        for (const obj of (res.Contents ?? [])) {
          if (obj.Key) out.push(obj.Key);
        }
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
      } while (token);
      return out;
    },
  };
  return adapter;
}
