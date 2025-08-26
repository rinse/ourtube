import Stream from "stream";
import { database, VideoMetadata } from "../../../database";
import { VideoStorage } from "../../../storage/VideoStorage";
import { IllegalArgumentError } from "../../../utils";

export type VideoFile = {
  status: 'ready',
  mime: string,
  stream: Stream.Readable,
} | {
  status: 'converting' | 'failed',
}

const allowedFileExtensions = ['.ts', '.vtt', '.m3u8'];
const allowedFilenames = ['index.m3u8', 'thumbnail.png'];

export async function getVideoFile(
  deps: { storage: VideoStorage },
  videoId: string,
  filename: string,
): Promise<VideoFile | null> {
  if (allowedFileExtensions.every(ext => !filename.endsWith(ext))
    && !allowedFilenames.includes(filename)) {
    throw new IllegalArgumentError('Invalid file type');
  }
  let metadata: VideoMetadata | null = await database.getVideoMetadata(videoId);
  if (metadata == null) {
    return null;
  }
  if (metadata.status !== 'ready') {
    return { status: metadata.status };
  }
  const { stream, mime } = await deps.storage.getFile(metadata.id, filename);
  return { status: 'ready', mime, stream };
}
