import { PlaylistStore } from '../../playlist/PlaylistStore';

export async function deletePlaylist(
  deps: { playlist: PlaylistStore },
  id: string,
): Promise<boolean> {
  return deps.playlist.delete(id);
}
