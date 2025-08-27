import { VideoItem, VideoListResponse } from "../../api-schemas";
import { Database, VideoMetadata } from "../../database";

export async function listVideos(deps: { database: Database }): Promise<VideoListResponse> {
  let videos: VideoMetadata[] = await deps.database.listVideos();
  const videoItems = videos.map(video => {
    return {
      id: video.id,
      title: video.title,
      hlsUrl: `/api/videos/${video.id}/index.m3u8`,
      status: video.status,
      thumbnailUrl: video.has_thumbnail ? `/api/videos/${video.id}/thumbnail.png` : undefined,
    } satisfies VideoItem;
  });
  return {
    videos: videoItems,
    count: videoItems.length,
  };
}
