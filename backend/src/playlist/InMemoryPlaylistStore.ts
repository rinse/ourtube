import { PlaylistStore } from './PlaylistStore';
import { Playlist, addMember, removeMember, reorderMembers } from './Playlist';
import { IllegalArgumentError } from '../utils';

/**
 * In-memory PlaylistStore for unit tests and quick local runs. Mirrors
 * DynamoPlaylistStore semantics (newest-first list, "false when absent" for
 * mutations, dangling-ref-preserving reorder, updated_at bumped on every
 * mutation).
 */
export class InMemoryPlaylistStore implements PlaylistStore {
  private readonly items = new Map<string, Playlist>();

  async create(playlist: Playlist): Promise<void> {
    this.items.set(playlist.id, { ...playlist, videoIds: [...playlist.videoIds] });
  }

  async get(id: string): Promise<Playlist | null> {
    const found = this.items.get(id);
    return found ? { ...found, videoIds: [...found.videoIds] } : null;
  }

  async list(): Promise<Playlist[]> {
    return [...this.items.values()]
      .sort((a, b) => b.created_at.localeCompare(a.created_at))
      .map((p) => ({ ...p, videoIds: [...p.videoIds] }));
  }

  async rename(id: string, name: string): Promise<boolean> {
    return this.patch(id, (p) => { p.name = name; });
  }

  async delete(id: string): Promise<boolean> {
    return this.items.delete(id);
  }

  async addVideo(id: string, videoId: string): Promise<boolean> {
    return this.patch(id, (p) => { p.videoIds = addMember(p.videoIds, videoId); });
  }

  async removeVideo(id: string, videoId: string): Promise<boolean> {
    return this.patch(id, (p) => { p.videoIds = removeMember(p.videoIds, videoId); });
  }

  async reorder(id: string, videoIds: string[]): Promise<boolean> {
    const existing = this.items.get(id);
    if (!existing) {
      return false;
    }
    const next = reorderMembers(existing.videoIds, videoIds);
    if (next == null) {
      throw new IllegalArgumentError('videoIds must be a duplicate-free subset of the current members');
    }
    existing.videoIds = next;
    existing.updated_at = new Date().toISOString();
    return true;
  }

  private patch(id: string, mutate: (p: Playlist) => void): boolean {
    const existing = this.items.get(id);
    if (!existing) {
      return false;
    }
    mutate(existing);
    existing.updated_at = new Date().toISOString();
    return true;
  }
}
