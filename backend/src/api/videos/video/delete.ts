import { MetadataStore } from '../../../metadata/MetadataStore';
import { VideoStorage } from '../../../storage/VideoStorage';

export async function deleteVideo(
  deps: { storage: VideoStorage; metadata: MetadataStore },
  videoId: string,
): Promise<boolean> {
  const video = await deps.metadata.get(videoId);
  if (video == null) {
    return false;
  }
  const dbDeleted = await deps.metadata.delete(videoId);
  if (!dbDeleted) {
    return false;
  }
  const deleted = await deps.storage.delete(video.id);
  if (!deleted) {
    console.warn(`Failed to delete video files for ${video.id}`);
  }
  return true;
}
