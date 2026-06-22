import { MetadataStore } from '../../../metadata/MetadataStore';
import { VideoStorage } from '../../../storage/VideoStorage';
import { Converter } from '../../../converter/Converter';

export async function deleteVideo(
  deps: { storage: VideoStorage; metadata: MetadataStore; converter: Converter },
  videoId: string,
): Promise<boolean> {
  const video = await deps.metadata.get(videoId);
  if (video == null) {
    return false;
  }
  if (video.status === 'converting' && video.converter_job_id) {
    await deps.converter.cancelJob(video.converter_job_id);
  }
  const dbDeleted = await deps.metadata.delete(videoId);
  if (!dbDeleted) {
    return false;
  }
  const deleted = await deps.storage.delete(video.id);
  if (!deleted) {
    console.warn(`Failed to delete video files for ${video.id}`);
  }
  try {
    await deps.storage.deleteUpload(video.id);
  } catch {
    // Source upload may already have been cleaned up by the converter.
  }
  return true;
}
