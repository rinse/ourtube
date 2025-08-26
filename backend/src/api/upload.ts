import { UploadResponse } from "../api-schemas";
import { database, VideoMetadata } from "../database";
import { VideoStorage } from "../storage";
import { unlink } from "../utils";
import { generateVideoId } from "../video-processor";

export async function uploadVideo(
  deps: { storage: VideoStorage },
  title: string,
  file: Express.Multer.File,
): Promise<UploadResponse | null> {
  const videoId = await generateVideoId(file.path);
  const existingVideo = await database.getVideoMetadata(videoId);
  if (existingVideo != null) {
    if (existingVideo.status !== 'failed') {
      // Do nothing if video already exists and is not failed
      return null;
    }
    // Delete existing file and re-upload if status is failed
    await unlink(file.path);
  }
  const metadata: VideoMetadata = {
    id: videoId,
    title: title,
    status: 'converting',
    created_at: new Date().toISOString(),
    has_thumbnail: false
  };
  await database.saveVideoMetadata(metadata);
  deps.storage.create(videoId, file.path); // start conversion in background
  return {
    message: 'Video uploaded successfully',
    status: 'converting',
    videoId,
    title,
  };
}
