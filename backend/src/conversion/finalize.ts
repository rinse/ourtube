import { MetadataStore } from '../metadata/MetadataStore';
import { VideoStorage } from '../storage/VideoStorage';

/**
 * Finalize a MediaConvert job: normalize the thumbnail name, flip the metadata
 * status, and clean up the source upload. Invoked from the MediaConvert
 * completion event (src/lambda/conversion.ts).
 */
export async function finalizeConversion(
  deps: { storage: VideoStorage; metadata: MetadataStore },
  videoId: string,
  success: boolean,
): Promise<void> {
  if (!success) {
    await deps.metadata.updateStatus(videoId, 'failed');
    await safeDeleteUpload(deps, videoId);
    console.error(`[${videoId}] conversion failed`);
    return;
  }

  let hasThumbnail = false;
  try {
    hasThumbnail = await deps.storage.normalizeThumbnail(videoId);
  } catch (error) {
    console.error(`[${videoId}] thumbnail normalization failed:`, error);
  }
  await deps.metadata.updateThumbnail(videoId, hasThumbnail);
  await deps.metadata.updateStatus(videoId, 'ready');
  await safeDeleteUpload(deps, videoId);
  console.log(`[${videoId}] conversion finalized (thumbnail=${hasThumbnail})`);
}

async function safeDeleteUpload(deps: { storage: VideoStorage }, videoId: string): Promise<void> {
  try {
    await deps.storage.deleteUpload(videoId);
  } catch (error) {
    console.error(`[${videoId}] failed to delete source upload:`, error);
  }
}
