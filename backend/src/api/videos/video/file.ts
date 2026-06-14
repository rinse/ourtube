import Stream from 'stream';
import { MetadataStore } from '../../../metadata/MetadataStore';
import { VideoMetadata } from '../../../metadata/VideoMetadata';
import { VideoStorage } from '../../../storage/VideoStorage';
import { IllegalArgumentError } from '../../../utils';
import { THUMBNAIL_FILENAME, getMimeType } from '../../../media/ffmpeg';

/**
 * Playback result. Single mechanism across local (MinIO) and prod (S3):
 *  - manifests (.m3u8) are fetched and rewritten so segment lines point at
 *    presigned S3/MinIO GET URLs (child manifests stay relative -> served here);
 *  - segments (.ts/.vtt) requested directly are redirected to a presigned URL;
 *  - the thumbnail is streamed through (small).
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
    const text = await deps.storage.getText(videoId, filename);
    const body = await rewriteManifest(text, (segment) => deps.storage.presignGetFile(videoId, segment));
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

/**
 * Rewrite an HLS manifest: segment URIs become presigned URLs, child manifests
 * stay relative (so they round-trip through this same endpoint), and comments
 * pass through untouched.
 */
async function rewriteManifest(
  text: string,
  presign: (filename: string) => Promise<string>,
): Promise<string> {
  const lines = text.split('\n');
  const out = await Promise.all(lines.map(async (line) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#') || trimmed.endsWith('.m3u8')) {
      return line;
    }
    return presign(trimmed);
  }));
  return out.join('\n');
}
