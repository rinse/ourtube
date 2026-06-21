import { AppConfig } from '../config';
import { VideoItem } from '../api-schemas';
import { VideoMetadata } from '../metadata/VideoMetadata';
import { THUMBNAIL_FILENAME } from '../media/ffmpeg';

/**
 * Build the API view of a video. Playback always goes through the API entrypoint
 * (`/api/videos/<id>/index.m3u8`): the manifest is session-gated and served verbatim;
 * each segment request is redirected (302) to a per-request presigned URL, so this
 * is the single delivery path for both local (MinIO) and prod (S3). CloudFront
 * proxies `/api/*` with caching disabled (CACHING_DISABLED), so these responses
 * are never cached at the edge.
 */
export function toVideoItem(_config: AppConfig, video: VideoMetadata): VideoItem {
  return {
    id: video.id,
    title: video.title,
    status: video.status,
    hlsUrl: `/api/videos/${video.id}/index.m3u8`,
    thumbnailUrl: video.has_thumbnail ? `/api/videos/${video.id}/${THUMBNAIL_FILENAME}` : undefined,
  };
}
