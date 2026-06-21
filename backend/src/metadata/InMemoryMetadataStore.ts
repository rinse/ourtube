import { MetadataStore } from './MetadataStore';
import { VideoMetadata, VideoStatus } from './VideoMetadata';

/**
 * In-memory MetadataStore for unit tests and quick local runs without a
 * DynamoDB instance. Mirrors DynamoMetadataStore semantics (newest-first list,
 * "false when video is absent" for updates).
 */
export class InMemoryMetadataStore implements MetadataStore {
  private readonly items = new Map<string, VideoMetadata>();

  async get(videoId: string): Promise<VideoMetadata | null> {
    return this.items.get(videoId) ?? null;
  }

  async getMany(ids: string[]): Promise<VideoMetadata[]> {
    return ids
      .map((id) => this.items.get(id))
      .filter((v): v is VideoMetadata => v != null);
  }

  async list(): Promise<VideoMetadata[]> {
    return [...this.items.values()].sort((a, b) =>
      b.created_at.localeCompare(a.created_at));
  }

  async save(metadata: VideoMetadata): Promise<void> {
    this.items.set(metadata.id, { ...metadata });
  }

  async delete(videoId: string): Promise<boolean> {
    return this.items.delete(videoId);
  }

  async updateTitle(videoId: string, title: string): Promise<boolean> {
    return this.patch(videoId, (m) => { m.title = title; });
  }

  async updateStatus(videoId: string, status: VideoStatus): Promise<boolean> {
    return this.patch(videoId, (m) => { m.status = status; });
  }

  async updateThumbnail(videoId: string, hasThumbnail: boolean): Promise<boolean> {
    return this.patch(videoId, (m) => { m.has_thumbnail = hasThumbnail; });
  }

  private patch(videoId: string, mutate: (m: VideoMetadata) => void): boolean {
    const existing = this.items.get(videoId);
    if (!existing) {
      return false;
    }
    mutate(existing);
    return true;
  }
}
