import { Readable } from 'stream';

/**
 * Object I/O for video sources and HLS outputs. Pure storage — no conversion
 * logic lives here (that moved to the Converter abstraction). Backed by S3 in
 * every environment; MinIO is used locally via a custom endpoint.
 *
 * Key layout:
 *   uploads/<videoId>          source upload (content-addressed by SHA256)
 *   videos/<videoId>/<file>    HLS manifest, segments, thumbnail.png
 */
export interface VideoStorage {
  /** Stream a single HLS output file (videos/<id>/<filename>). */
  getFile(videoId: string, filename: string): Promise<{ stream: Readable; mime: string }>;
  /** Read a small text file (e.g. a manifest) fully into a string. */
  getText(videoId: string, filename: string): Promise<string>;
  /** Presigned GET URL for a single HLS output file (used for segments). */
  presignGetFile(videoId: string, filename: string): Promise<string>;
  existsFile(videoId: string, filename: string): Promise<boolean>;
  /** True once HLS outputs exist (videos/<id>/index.m3u8). */
  exists(videoId: string): Promise<boolean>;
  /** Delete all HLS outputs for a video. */
  delete(videoId: string): Promise<boolean>;

  /** S3 key for the source upload. */
  uploadKey(videoId: string): string;
  /** Presigned PUT URL the browser uses to upload the source directly. */
  presignUpload(videoId: string, contentType?: string): Promise<string>;
  /** Download the source upload to a local path (used by the local converter). */
  downloadUpload(videoId: string, destPath: string): Promise<void>;
  deleteUpload(videoId: string): Promise<void>;

  /** Publish a directory of HLS outputs to videos/<id>/ (used by the local converter). */
  uploadVideoDir(videoId: string, localDir: string): Promise<void>;

  /**
   * Rename a MediaConvert frame-capture output (videos/<id>/thumb*.jpg) to the
   * canonical videos/<id>/thumbnail.jpg. Returns whether a thumbnail was found.
   */
  normalizeThumbnail(videoId: string): Promise<boolean>;
}
