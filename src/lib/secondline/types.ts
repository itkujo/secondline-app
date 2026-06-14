/**
 * Second Line types. Hand-written to match the SQLite row shapes in db.ts.
 * Keep in sync with migrations there.
 */

export type EventStatus = 'active' | 'expired';
export type AssetSource = 'guest' | 'booth';
export type BackendId = string; // resolved against the registry at runtime

export interface EventRow {
  id: number;
  slug: string;
  storage_backend_id: BackendId;
  host_first_name: string;
  host_last_name: string;
  host_email: string;
  event_date: string;                 // YYYY-MM-DD
  pictime_gallery_url: string | null;
  expires_at: string | null;          // ISO timestamp (computed: event_date + 180 days)
  status: EventStatus;
  first_upload_at: string | null;
  warned_30_at: string | null;
  wall_dwell_ms: number;              // ms each photo stays on the wall
  wall_crossfade_ms: number;          // ms of crossfade between wall items
  wall_video_max_ms: number;          // ms cap for video playback on the wall
  wall_video_full: number;            // 0/1 — play videos to the end (ignores cap)
  wall_hide_bg: number;               // 0/1 — hide the blurred scrolling background
  wall_hide_qr: number;               // 0/1 — hide the upload-QR overlay
  wall_hide_caption: number;          // 0/1 — hide "Shared by <name>" captions
  wall_transition: string;            // hero transition: crossfade | slide | zoom | kenburns
  wall_bg_key: string | null;         // storage key of a custom wall background, if set
  language: string | null;            // per-event default locale ('en'|'es'); null = browser auto-detect
  created_at: string;
}

export interface AssetRow {
  id: number;
  event_id: number;
  source: AssetSource;
  storage_key: string;                // path in the backend bucket
  thumb_storage_key: string | null;
  mime_type: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  uploader_name: string | null;
  uploaded_at: string;
  deleted_at: string | null;
}

/**
 * StorageBackend = an S3-compatible endpoint we can read/write to.
 * Built from a registry entry (secondline-backends.json) + env vars at runtime.
 */
export interface StorageBackend {
  id: BackendId;
  label: string;
  endpoint: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
  forcePathStyle: boolean;            // true for MinIO/Garage, false for Wasabi
}

export interface BackendRegistryEntry {
  id: string;
  label: string;
  endpoint: string;
  region: string;
  bucket: string;
  access_key_env: string;             // env var name to read access key from
  secret_key_env: string;
  force_path_style?: boolean;
}

/**
 * Public view of an asset — what we send to clients via SSE and the gallery API.
 * Never includes the raw storage_key (backend-id is an internal routing detail).
 */
export interface PublicAsset {
  id: number;
  src: string;                        // /m/<slug>/<id>
  thumb: string;                      // /m/<slug>/<id>_thumb
  mime_type: string;
  width: number | null;
  height: number | null;
  duration_ms: number | null;
  uploader_name: string | null;
  uploaded_at: string;
}

export interface SseAssetAdded {
  type: 'asset.added';
  asset: PublicAsset;
  ts: string;                         // ISO timestamp for ?since= replay
}

export interface SseAssetRemoved {
  type: 'asset.removed';
  id: number;
  ts: string;
}

export type SseMessage = SseAssetAdded | SseAssetRemoved;
