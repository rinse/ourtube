import { randomUUID } from 'crypto';
import { PlaylistSummary } from '../../api-schemas';
import { PlaylistStore } from '../../playlist/PlaylistStore';
import { Playlist } from '../../playlist/Playlist';
import { toPlaylistSummary } from './view';

export async function createPlaylist(
  deps: { playlist: PlaylistStore },
  name: string,
): Promise<PlaylistSummary> {
  const now = new Date().toISOString();
  const playlist: Playlist = {
    id: randomUUID(),
    name,
    created_at: now,
    updated_at: now,
    videoIds: [],
  };
  await deps.playlist.create(playlist);
  return toPlaylistSummary(playlist);
}
