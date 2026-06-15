import { PlaylistListResponse } from '../../api-schemas';
import { PlaylistStore } from '../../playlist/PlaylistStore';
import { toPlaylistSummary } from './view';

export async function listPlaylists(
  deps: { playlist: PlaylistStore },
): Promise<PlaylistListResponse> {
  const playlists = await deps.playlist.list();
  return {
    playlists: playlists.map(toPlaylistSummary),
    count: playlists.length,
  };
}
