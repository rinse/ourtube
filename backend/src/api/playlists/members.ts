import { PlaylistStore } from '../../playlist/PlaylistStore';
import { MetadataStore } from '../../metadata/MetadataStore';

export type AddVideoResult = 'ok' | 'playlist_not_found' | 'video_not_found';

/**
 * Add a video to a playlist. The video must currently exist (reject adding a
 * garbage/unknown id); later deletion is tolerated and skipped on read. Adding
 * an already-present video is idempotent → 'ok'.
 */
export async function addPlaylistVideo(
  deps: { playlist: PlaylistStore; metadata: MetadataStore },
  playlistId: string,
  videoId: string,
): Promise<AddVideoResult> {
  const video = await deps.metadata.get(videoId);
  if (video == null) {
    return 'video_not_found';
  }
  const ok = await deps.playlist.addVideo(playlistId, videoId);
  return ok ? 'ok' : 'playlist_not_found';
}

export async function removePlaylistVideo(
  deps: { playlist: PlaylistStore },
  playlistId: string,
  videoId: string,
): Promise<boolean> {
  return deps.playlist.removeVideo(playlistId, videoId);
}

/**
 * Reorder a playlist's members. `videoIds` is the desired order; it must be a
 * duplicate-free subset of the current members (the UI only sees resolved
 * videos, so dangling refs are legitimately absent and are preserved at the
 * end). Throws IllegalArgumentError on an invalid payload (→ 400). Returns
 * false when the playlist is absent (→ 404).
 */
export async function reorderPlaylistVideos(
  deps: { playlist: PlaylistStore },
  playlistId: string,
  videoIds: string[],
): Promise<boolean> {
  return deps.playlist.reorder(playlistId, videoIds);
}
