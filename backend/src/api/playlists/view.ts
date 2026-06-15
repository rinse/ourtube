import { PlaylistSummary } from '../../api-schemas';
import { Playlist } from '../../playlist/Playlist';

/** API view of a playlist for the list endpoint (videos not resolved). */
export function toPlaylistSummary(p: Playlist): PlaylistSummary {
  return {
    id: p.id,
    name: p.name,
    videoCount: p.videoIds.length,
    created_at: p.created_at,
    updated_at: p.updated_at,
  };
}
