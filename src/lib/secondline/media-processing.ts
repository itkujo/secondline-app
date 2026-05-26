/**
 * Second Line media processing.
 *
 * Photos: EXIF auto-rotate, dimension extraction, thumbnail generation
 * (400 px longest edge). Output is always JPEG. Input accepted: JPEG, PNG,
 * WebP. **HEIC is NOT processed here** — the guest upload island converts
 * .heic → JPEG in the browser via heic2any before posting, because sharp's
 * npm prebuild does not include libde265 (the HEVC decoder needed for
 * iPhone HEIC files).
 *
 * Videos: pass-through. We do not transcode in v1. We don't even probe frame
 * size — that requires ffprobe which is out of scope. The wall renders videos
 * at their native aspect ratio via the same padding rule as photos, so size
 * matters only for the layout math; null dimensions are tolerated.
 *
 * Size limits per the decision matrix:
 *   - Photos: 10 MB
 *   - Videos: 50 MB
 */

import sharp from 'sharp';

export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;   // 10 MB
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;   // 50 MB

export const ACCEPTED_IMAGE_MIME = [
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
];
// HEIC/HEIF intentionally excluded — clients (the guest upload island) convert
// .heic to JPEG via heic2any in the browser before POSTing. The server's sharp
// prebuild lacks libde265 (HEVC) so it cannot decode HEIC files. If a raw HEIC
// somehow reaches this code path (e.g. heic2any failed), the upload route will
// 415 with a clear error and the guest sees "couldn't process this photo".
export const ACCEPTED_VIDEO_MIME = [
  'video/mp4', 'video/quicktime', 'video/webm',
];
export const ALL_ACCEPTED_MIME = [...ACCEPTED_IMAGE_MIME, ...ACCEPTED_VIDEO_MIME];

const THUMB_MAX_EDGE = 400;

export function isAcceptedMime(m: string): boolean {
  return ALL_ACCEPTED_MIME.includes(m.toLowerCase());
}

export function isImageMime(m: string): boolean {
  return ACCEPTED_IMAGE_MIME.includes(m.toLowerCase());
}

export function isVideoMime(m: string): boolean {
  return ACCEPTED_VIDEO_MIME.includes(m.toLowerCase());
}

export interface ProcessedMedia {
  main: Buffer;
  thumb: Buffer | null;
  mimeType: string;             // canonical MIME of `main`
  width: number | null;
  height: number | null;
  durationMs: number | null;
}

export async function processImageUpload(input: Buffer, declaredMime: string): Promise<ProcessedMedia> {
  if (input.length > MAX_IMAGE_BYTES) {
    throw new Error(`Image size ${input.length} exceeds max ${MAX_IMAGE_BYTES}`);
  }
  if (!isImageMime(declaredMime)) {
    throw new Error(`Unsupported image MIME: ${declaredMime}`);
  }

  // .rotate() with no args = EXIF-aware auto-rotate. Note: sharp's
  // metadata() on the pipeline still reports the pre-rotation dimensions
  // because EXIF rotation only applies on output. Read dimensions from the
  // rendered main JPEG so width/height reflect the actual stored bytes.
  const pipeline = sharp(input).rotate();
  const main = await pipeline.clone().jpeg({ quality: 90, mozjpeg: true, progressive: true }).toBuffer();
  const thumb = await pipeline.clone().resize({
    width: THUMB_MAX_EDGE, height: THUMB_MAX_EDGE, fit: 'inside', withoutEnlargement: true,
  }).jpeg({ quality: 75, mozjpeg: true, progressive: true }).toBuffer();

  const mainMeta = await sharp(main).metadata();
  const width = mainMeta.width ?? null;
  const height = mainMeta.height ?? null;

  return { main, thumb, mimeType: 'image/jpeg', width, height, durationMs: null };
}

export async function processVideoUpload(input: Buffer, declaredMime: string): Promise<ProcessedMedia> {
  if (input.length > MAX_VIDEO_BYTES) {
    throw new Error(`Video size ${input.length} exceeds max ${MAX_VIDEO_BYTES}`);
  }
  if (!isVideoMime(declaredMime)) {
    throw new Error(`Unsupported video MIME: ${declaredMime}`);
  }
  // Pass-through. v2+ may add ffprobe-based dimensions and thumbnail extraction.
  return { main: input, thumb: null, mimeType: declaredMime.toLowerCase(), width: null, height: null, durationMs: null };
}

/**
 * Top-level dispatcher used by the upload route.
 */
export async function processUpload(input: Buffer, declaredMime: string): Promise<ProcessedMedia> {
  if (isImageMime(declaredMime)) return processImageUpload(input, declaredMime);
  if (isVideoMime(declaredMime)) return processVideoUpload(input, declaredMime);
  throw new Error(`Unsupported MIME: ${declaredMime}`);
}
