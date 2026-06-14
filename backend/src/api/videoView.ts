import { AppConfig } from '../config';
import { VideoItem } from '../api-schemas';
import { VideoMetadata } from '../metadata/VideoMetadata';
import { THUMBNAIL_FILENAME } from '../media/ffmpeg';

/**
 * Build the API view of a video. Playback always goes through the API entrypoint
 * (`/api/videos/<id>/index.m3u8`): the manifest is session-gated and rewritten to
 * presigned segment URLs, so this is the single delivery path for both local
 * (MinIO) and prod (S3). CloudFront still caches these responses in front.
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
