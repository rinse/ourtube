import { Playlist } from './Playlist';

/**
 * Persistence boundary for playlists. Kept deliberately thin (mirroring
 * MetadataStore) so an in-memory fake can stand in for unit tests without a
 * running DynamoDB. Member operations live here so their logic is exercised by
 * the fake; video existence is validated one layer up (handlers have metadata).
 *
 * Mutation methods return `false` when the playlist is absent (→ handler 404),
 * mirroring `MetadataStore.updateX` + `attribute_exists(PK)`.
 */
export interface PlaylistStore {
  create(playlist: Playlist): Promise<void>;
  get(id: string): Promise<Playlist | null>;
  /** Newest-first. */
  list(): Promise<Playlist[]>;
  rename(id: string, name: string): Promise<boolean>;
  delete(id: string): Promise<boolean>;
  /** Append (dedup). False if the playlist is absent. */
  addVideo(id: string, videoId: string): Promise<boolean>;
  /** Remove the video. False if the playlist is absent. */
  removeVideo(id: string, videoId: string): Promise<boolean>;
  /**
   * Reorder members to `videoIds` (a dup-free subset of the current members;
   * dangling refs are preserved at the end). False if the playlist is absent.
   * Throws IllegalArgumentError if `videoIds` is not a valid subset.
   */
  reorder(id: string, videoIds: string[]): Promise<boolean>;
}
