import { describe, it, expect } from 'vitest';
import sharp from 'sharp';
import {
  processImageUpload, processVideoUpload, isAcceptedMime,
  ACCEPTED_IMAGE_MIME, ACCEPTED_VIDEO_MIME, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
} from '../media-processing';

async function makeJpegBuffer(w = 200, h = 100): Promise<Buffer> {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 255, g: 0, b: 0 } } }).jpeg().toBuffer();
}

describe('media-processing', () => {
  // Note: heic/heif intentionally excluded — converted client-side before upload, server never sees them.
  it('isAcceptedMime accepts jpeg, png, webp, common video MIMEs', () => {
    for (const m of ACCEPTED_IMAGE_MIME) expect(isAcceptedMime(m)).toBe(true);
    for (const m of ACCEPTED_VIDEO_MIME) expect(isAcceptedMime(m)).toBe(true);
    expect(isAcceptedMime('application/pdf')).toBe(false);
    expect(isAcceptedMime('image/gif')).toBe(false);   // explicitly not in v1
    expect(isAcceptedMime('image/heic')).toBe(false);  // client converts before upload
    expect(isAcceptedMime('image/heif')).toBe(false);  // client converts before upload
  });

  it('processImageUpload returns normalized JPEG + thumbnail + dimensions', async () => {
    const input = await makeJpegBuffer(800, 600);
    const r = await processImageUpload(input, 'image/jpeg');
    expect(r.mimeType).toBe('image/jpeg');
    expect(r.width).toBe(800);
    expect(r.height).toBe(600);
    expect(r.main.length).toBeGreaterThan(0);
    expect(r.thumb!.length).toBeGreaterThan(0);
    expect(r.thumb!.length).toBeLessThan(r.main.length);
    const tmeta = await sharp(r.thumb!).metadata();
    expect(Math.max(tmeta.width ?? 0, tmeta.height ?? 0)).toBeLessThanOrEqual(400);
  });

  it('processImageUpload rotates per EXIF before measuring', async () => {
    const input = await sharp({ create: { width: 200, height: 100, channels: 3, background: { r: 0, g: 255, b: 0 } } })
      .withMetadata({ orientation: 6 }).jpeg().toBuffer();
    const r = await processImageUpload(input, 'image/jpeg');
    // After auto-rotation, what was 200×100 with orientation=6 becomes 100×200
    expect(r.width).toBe(100);
    expect(r.height).toBe(200);
  });

  it('processImageUpload rejects oversize images', async () => {
    const huge = Buffer.alloc(MAX_IMAGE_BYTES + 1);
    await expect(processImageUpload(huge, 'image/jpeg')).rejects.toThrow(/size/i);
  });

  it('processVideoUpload passes the body through and returns null dimensions', async () => {
    const buf = Buffer.alloc(1024);
    const r = await processVideoUpload(buf, 'video/mp4');
    expect(r.main).toBe(buf);
    expect(r.mimeType).toBe('video/mp4');
    expect(r.width).toBeNull();
    expect(r.height).toBeNull();
  });

  it('processVideoUpload rejects oversize videos', async () => {
    const huge = Buffer.alloc(MAX_VIDEO_BYTES + 1);
    await expect(processVideoUpload(huge, 'video/mp4')).rejects.toThrow(/size/i);
  });
});
