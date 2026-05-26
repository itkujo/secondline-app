import { describe, it, expect, vi } from 'vitest';
import type { StorageBackend } from '../../types';

// Mock the AWS SDK before importing the wrapper
vi.mock('@aws-sdk/client-s3', () => {
  const send = vi.fn();
  return {
    S3Client: vi.fn().mockImplementation(opts => ({ send, _opts: opts })),
    PutObjectCommand: vi.fn().mockImplementation(input => ({ _cmd: 'put', input })),
    GetObjectCommand: vi.fn().mockImplementation(input => ({ _cmd: 'get', input })),
    DeleteObjectCommand: vi.fn().mockImplementation(input => ({ _cmd: 'del', input })),
    HeadObjectCommand: vi.fn().mockImplementation(input => ({ _cmd: 'head', input })),
    ListObjectsV2Command: vi.fn().mockImplementation(input => ({ _cmd: 'list', input })),
  };
});

import * as awsMock from '@aws-sdk/client-s3';
import { createS3Adapter } from '../s3';

const backend: StorageBackend = {
  id: 'wasabi', label: 'Wasabi',
  endpoint: 'https://s3.us-east-1.wasabisys.com',
  region: 'us-east-1', bucket: 'secondline-prod',
  accessKey: 'AK', secretKey: 'SK', forcePathStyle: false,
};

describe('s3 adapter', () => {
  it('constructs an S3Client with the backend credentials and endpoint', () => {
    createS3Adapter(backend);
    expect(awsMock.S3Client).toHaveBeenCalledWith(expect.objectContaining({
      endpoint: backend.endpoint,
      region: backend.region,
      credentials: { accessKeyId: 'AK', secretAccessKey: 'SK' },
      forcePathStyle: false,
    }));
  });

  it('putObject sends a PutObjectCommand with bucket/key/body/contentType', async () => {
    const adapter = createS3Adapter(backend);
    const send = (adapter as unknown as { _send: ReturnType<typeof vi.fn> })._send;
    send.mockResolvedValueOnce({});
    await adapter.putObject({ key: 'a/b.jpg', body: Buffer.from('x'), contentType: 'image/jpeg' });
    expect(awsMock.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: 'secondline-prod', Key: 'a/b.jpg', Body: Buffer.from('x'), ContentType: 'image/jpeg',
      CacheControl: undefined, Metadata: undefined,
    });
    expect(send).toHaveBeenCalled();
  });

  it('getObjectStream returns the SDK response Body', async () => {
    const adapter = createS3Adapter(backend);
    const send = (adapter as unknown as { _send: ReturnType<typeof vi.fn> })._send;
    const fakeStream = { pipe: vi.fn() };
    send.mockResolvedValueOnce({ Body: fakeStream, ContentType: 'image/jpeg', ContentLength: 999 });
    const r = await adapter.getObjectStream('a/b.jpg');
    expect(r.body).toBe(fakeStream);
    expect(r.contentType).toBe('image/jpeg');
    expect(r.contentLength).toBe(999);
  });
});
