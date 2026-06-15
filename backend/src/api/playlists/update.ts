import { PlaylistStore } from '../../playlist/PlaylistStore';

export async function renamePlaylist(
  deps: { playlist: PlaylistStore },
  id: string,
  name: string,
): Promise<boolean> {
  return deps.playlist.rename(id, name);
}
