import { VideoInfoResponse } from "../../api-schemas";
import { Database } from "../../database";

export async function getVideo(deps: { database: Database }, videoId: string): Promise<VideoInfoResponse | null> {
  const video = await deps.database.getVideoMetadata(videoId);
  if (video == null) {
    return null;
  }
  return {
    id: video.id,
    title: video.title,
    hlsUrl: `/api/videos/${video.id}/index.m3u8`,
    status: video.status,
    thumbnailUrl: video.has_thumbnail ? `/api/videos/${video.id}/thumbnail.png` : undefined,
  };
}
