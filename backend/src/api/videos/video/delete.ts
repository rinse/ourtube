import { database } from "../../../database";
import { VideoStorage } from "../../../storage/VideoStorage";

export async function deleteVideo(
  deps: { storage: VideoStorage },
  videoId: string,
): Promise<boolean> {
  const video = await database.getVideoMetadata(videoId);
  if (video == null) {
    return false;
  }
  const dbDeleted = await database.deleteVideo(videoId);
  if (!dbDeleted) {
    return false;
  }
  const deleted = await deps.storage.delete(video.id);
  if (!deleted) {
    console.warn(`Failed to delete video directory for ${video.id}`);
  }
  return true;
}
