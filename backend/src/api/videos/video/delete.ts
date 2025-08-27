import { Database } from "../../../database";
import { VideoStorage } from "../../../storage/VideoStorage";

export async function deleteVideo(
  deps: { storage: VideoStorage, database: Database },
  videoId: string,
): Promise<boolean> {
  const video = await deps.database.getVideoMetadata(videoId);
  if (video == null) {
    return false;
  }
  const dbDeleted = await deps.database.deleteVideo(videoId);
  if (!dbDeleted) {
    return false;
  }
  const deleted = await deps.storage.delete(video.id);
  if (!deleted) {
    console.warn(`Failed to delete video directory for ${video.id}`);
  }
  return true;
}
