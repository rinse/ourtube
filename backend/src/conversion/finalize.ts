import { MetadataStore } from '../metadata/MetadataStore';
import { VideoStorage } from '../storage/VideoStorage';

export async function markConversionFailed(
  deps: { storage: VideoStorage; metadata: MetadataStore },
  videoId: string,
): Promise<void> {
  // EventBridge delivers at-least-once, so a STOPPED event may arrive (or be
  // redelivered) after the task has already finalized this video. If it is
  // already in a terminal state, treat this as a no-op rather than drag a
  // `ready` video back to `failed`.
  const existing = await deps.metadata.get(videoId);
  if (!existing) {
    console.log(`[${videoId}] markConversionFailed: record not found (deleted?), skipping`);
    return;
  }
  if (existing.status === 'ready' || existing.status === 'failed') {
    console.log(`[${videoId}] markConversionFailed: already ${existing.status}, skipping duplicate event`);
    return;
  }

  await deps.metadata.updateStatus(videoId, 'failed');
  try {
    await deps.storage.deleteUpload(videoId);
  } catch (error) {
    console.error(`[${videoId}] failed to delete source upload:`, error);
  }
  console.error(`[${videoId}] conversion failed`);
}
