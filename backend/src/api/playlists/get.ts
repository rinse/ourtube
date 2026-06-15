import { AppConfig } from '../../config';
import { PlaylistDetailResponse, VideoItem } from '../../api-schemas';
import { PlaylistStore } from '../../playlist/PlaylistStore';
import { MetadataStore } from '../../metadata/MetadataStore';
import { toVideoItem } from '../videoView';

/**
 * Resolve a playlist's members to full video views, in playlist order. Videos
 * that no longer exist (deleted, leaving a dangling ref in the stored array)
 * are skipped — the playlist never crashes on a missing member.
 */
export async function getPlaylist(
  deps: { playlist: PlaylistStore; metadata: MetadataStore; config: AppConfig },
  id: string,
): Promise<PlaylistDetailResponse | null> {
  const playlist = await deps.playlist.get(id);
  if (playlist == null) {
    return null;
  }
  const resolved = await Promise.all(
    playlist.videoIds.map((videoId) => deps.metadata.get(videoId)),
  );
  const videos: VideoItem[] = resolved
    .filter((v) => v != null)
    .map((v) => toVideoItem(deps.config, v!));
  return {
    id: playlist.id,
    name: playlist.name,
    created_at: playlist.created_at,
    updated_at: playlist.updated_at,
    videos,
  };
}
