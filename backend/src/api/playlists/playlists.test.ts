import { describe, it, expect, beforeEach } from 'vitest';
import { AppConfig } from '../../config';
import { InMemoryMetadataStore } from '../../metadata/InMemoryMetadataStore';
import { InMemoryPlaylistStore } from '../../playlist/InMemoryPlaylistStore';
import { VideoMetadata } from '../../metadata/VideoMetadata';
import { listPlaylists } from './list';
import { createPlaylist } from './create';
import { getPlaylist } from './get';
import { renamePlaylist } from './update';
import { deletePlaylist } from './delete';
import { addPlaylistVideo, removePlaylistVideo, reorderPlaylistVideos } from './members';
import { IllegalArgumentError } from '../../utils';

// toVideoItem ignores config, so an empty cast is sufficient for these tests.
const config = {} as AppConfig;

function video(id: string): VideoMetadata {
  return { id, title: `Title ${id}`, status: 'ready', created_at: '2025-01-01T00:00:00Z', has_thumbnail: false };
}

describe('playlist handlers', () => {
  let metadata: InMemoryMetadataStore;
  let playlist: InMemoryPlaylistStore;

  beforeEach(() => {
    metadata = new InMemoryMetadataStore();
    playlist = new InMemoryPlaylistStore();
  });

  it('create → list reflects the new playlist with videoCount 0', async () => {
    const created = await createPlaylist({ playlist }, 'My List');
    expect(created.name).toBe('My List');
    expect(created.videoCount).toBe(0);
    const listed = await listPlaylists({ playlist });
    expect(listed.count).toBe(1);
    expect(listed.playlists[0].id).toBe(created.id);
  });

  it('getPlaylist resolves members in order and skips deleted/missing videos', async () => {
    await metadata.save(video('a'));
    await metadata.save(video('c'));
    const created = await createPlaylist({ playlist }, 'L');
    await addPlaylistVideo({ playlist, metadata }, created.id, 'a');
    // 'b' added then its video deleted → dangling ref
    await metadata.save(video('b'));
    await addPlaylistVideo({ playlist, metadata }, created.id, 'b');
    await metadata.delete('b');
    await addPlaylistVideo({ playlist, metadata }, created.id, 'c');

    const detail = await getPlaylist({ playlist, metadata, config }, created.id);
    expect(detail).not.toBeNull();
    expect(detail!.videos.map((v) => v.id)).toEqual(['a', 'c']); // 'b' skipped, order kept
  });

  it('getPlaylist returns null for an unknown playlist', async () => {
    expect(await getPlaylist({ playlist, metadata, config }, 'nope')).toBeNull();
  });

  it('rename / delete return false when the playlist is absent', async () => {
    expect(await renamePlaylist({ playlist }, 'nope', 'X')).toBe(false);
    expect(await deletePlaylist({ playlist }, 'nope')).toBe(false);
  });

  it('addPlaylistVideo rejects an unknown video and a missing playlist', async () => {
    const created = await createPlaylist({ playlist }, 'L');
    expect(await addPlaylistVideo({ playlist, metadata }, created.id, 'ghost')).toBe('video_not_found');
    await metadata.save(video('a'));
    expect(await addPlaylistVideo({ playlist, metadata }, 'no-playlist', 'a')).toBe('playlist_not_found');
    expect(await addPlaylistVideo({ playlist, metadata }, created.id, 'a')).toBe('ok');
  });

  it('removePlaylistVideo returns false when the playlist is absent', async () => {
    expect(await removePlaylistVideo({ playlist }, 'nope', 'a')).toBe(false);
  });

  it('reorderPlaylistVideos throws on invalid payload and returns false when absent', async () => {
    const created = await createPlaylist({ playlist }, 'L');
    await metadata.save(video('a'));
    await addPlaylistVideo({ playlist, metadata }, created.id, 'a');
    await expect(reorderPlaylistVideos({ playlist }, created.id, ['a', 'z']))
      .rejects.toThrow(IllegalArgumentError);
    expect(await reorderPlaylistVideos({ playlist }, 'nope', [])).toBe(false);
  });
});
