import Stream from 'stream';
import { MetadataStore } from '../../../metadata/MetadataStore';
import { VideoMetadata } from '../../../metadata/VideoMetadata';
import { VideoStorage } from '../../../storage/VideoStorage';
import { IllegalArgumentError } from '../../../utils';
import { THUMBNAIL_FILENAME, getMimeType } from '../../../media/ffmpeg';

/**
 * Playback result. Single mechanism across local (MinIO) and prod (S3):
 *  - manifests (.m3u8) are served verbatim: every line (segments and child
 *    manifests alike) stays relative, so the browser re-requests each one
 *    through this same endpoint;
 *  - segments (.ts/.vtt) requested directly are redirected to a freshly
 *    presigned URL (signed at request time, so there is no playback-wide
 *    expiry: a >1h video, or a long pause/resume, never hits a stale 403);
 *  - the thumbnail is streamed through (small).
 *
 * Tradeoff: each segment costs one extra 302 round-trip to the API. For a
 * single-user service that is negligible, and it keeps every presign TTL scoped
 * to a single segment fetch rather than to the whole playback session.
 */
export type VideoFile =
  | { status: 'ready'; kind: 'manifest'; body: string; mime: string }
  | { status: 'ready'; kind: 'redirect'; url: string }
  | { status: 'ready'; kind: 'stream'; mime: string; stream: Stream.Readable }
  | { status: 'converting' | 'failed' };

const allowedFileExtensions = ['.ts', '.vtt', '.m3u8'];
const allowedFilenames = ['index.m3u8', THUMBNAIL_FILENAME];

export async function getVideoFile(
  deps: { storage: VideoStorage; metadata: MetadataStore },
  videoId: string,
  filename: string,
): Promise<VideoFile | null> {
  if (allowedFileExtensions.every((ext) => !filename.endsWith(ext))
    && !allowedFilenames.includes(filename)) {
    throw new IllegalArgumentError('Invalid file type');
  }
  const metadata: VideoMetadata | null = await deps.metadata.get(videoId);
  if (metadata == null) {
    return null;
  }
  if (metadata.status !== 'ready') {
    return { status: metadata.status };
  }

  if (filename.endsWith('.m3u8')) {
    // Serve the manifest verbatim: segment lines stay relative so the browser
    // re-requests each through GET /api/videos/:id/:segment, which presigns at
    // request time.
    const body = await deps.storage.getText(videoId, filename);
    return { status: 'ready', kind: 'manifest', body, mime: getMimeType(filename) };
  }

  if (filename === THUMBNAIL_FILENAME) {
    if (!(await deps.storage.existsFile(videoId, filename))) {
      return null; // 404 rather than a 500 if the thumbnail is absent
    }
    const { stream, mime } = await deps.storage.getFile(videoId, filename);
    return { status: 'ready', kind: 'stream', mime, stream };
  }

  // .ts / .vtt requested directly -> hand off to a presigned URL.
  const url = await deps.storage.presignGetFile(videoId, filename);
  return { status: 'ready', kind: 'redirect', url };
}
