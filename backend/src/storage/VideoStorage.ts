import { Readable } from 'stream';

/**
 * Object I/O for video sources and HLS outputs. Pure storage — no conversion
 * logic lives here. Backed by S3 in every environment; MinIO is used locally
 * via a custom endpoint.
 *
 * Key layout:
 *   uploads/<videoId>          source upload (content-addressed by SHA256)
 *   videos/<videoId>/<file>    HLS manifest, segments, thumbnail.jpg
 */
export interface VideoStorage {
  getFile(videoId: string, filename: string): Promise<{ stream: Readable; mime: string }>;
  getText(videoId: string, filename: string): Promise<string>;
  presignGetFile(videoId: string, filename: string): Promise<string>;
  existsFile(videoId: string, filename: string): Promise<boolean>;
  delete(videoId: string): Promise<boolean>;

  uploadKey(videoId: string): string;
  presignUpload(videoId: string, contentType?: string): Promise<string>;
  downloadUpload(videoId: string, destPath: string): Promise<void>;
  deleteUpload(videoId: string): Promise<void>;

  uploadVideoDir(videoId: string, localDir: string): Promise<void>;
}
