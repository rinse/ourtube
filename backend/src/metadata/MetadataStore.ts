import { VideoMetadata, VideoStatus } from './VideoMetadata';

/**
 * Persistence boundary for video metadata. Mirrors the method surface of the
 * old `Database` class so the API layer is unchanged, but is backed by
 * DynamoDB in every environment (DynamoDB Local for dev/test, AWS for prod).
 *
 * Kept deliberately thin so an in-memory fake can stand in for unit tests
 * without requiring a running DynamoDB.
 */
export interface MetadataStore {
  get(videoId: string): Promise<VideoMetadata | null>;
  /**
   * Batch lookup. Returns only the videos that exist — missing ids are
   * silently dropped (no error, no placeholder). Order is not guaranteed to
   * match `ids`; callers that need a specific order should re-order themselves.
   */
  getMany(ids: string[]): Promise<VideoMetadata[]>;
  list(): Promise<VideoMetadata[]>;
  save(metadata: VideoMetadata): Promise<void>;
  delete(videoId: string): Promise<boolean>;
  updateTitle(videoId: string, title: string): Promise<boolean>;
  updateStatus(videoId: string, status: VideoStatus): Promise<boolean>;
  updateThumbnail(videoId: string, hasThumbnail: boolean): Promise<boolean>;
}
