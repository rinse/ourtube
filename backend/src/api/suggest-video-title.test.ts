import { describe, it, expect, beforeEach } from 'vitest';
import { collectPlaylistSiblingTitles, suggetVideoTitle } from './suggest-video-title';
import { InMemoryMetadataStore } from '../metadata/InMemoryMetadataStore';
import { InMemoryPlaylistStore } from '../playlist/InMemoryPlaylistStore';
import { VideoMetadata } from '../metadata/VideoMetadata';
import { GenAI } from '../genai/GenAI';
import { IllegalArgumentError } from '../utils';

function video(id: string, title?: string): VideoMetadata {
  return { id, title: title ?? `Title ${id}`, status: 'ready', created_at: '2025-01-01T00:00:00Z', has_thumbnail: false };
}

function fakeGenAI(result: string | undefined = 'Suggested'): GenAI & { calls: Array<{ filename: string; playlistTitles: string[] }> } {
  const calls: Array<{ filename: string; playlistTitles: string[] }> = [];
  return {
    calls,
    suggestVideoTitle: async (filename: string, playlistTitles: string[]) => {
      calls.push({ filename, playlistTitles });
      return result;
    },
  };
}

describe('collectPlaylistSiblingTitles', () => {
  let metadata: InMemoryMetadataStore;
  let playlist: InMemoryPlaylistStore;

  beforeEach(() => {
    metadata = new InMemoryMetadataStore();
    playlist = new InMemoryPlaylistStore();
  });

  it('video in one playlist: siblings are the other members\' titles in playlist order, self excluded', async () => {
    await metadata.save(video('a', 'Alpha'));
    await metadata.save(video('b', 'Beta'));
    await metadata.save(video('c', 'Gamma'));
    await playlist.create({ id: 'p1', name: 'P1', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', videoIds: ['a', 'b', 'c'] });

    expect(await collectPlaylistSiblingTitles({ playlist, metadata }, 'b')).toEqual(['Alpha', 'Gamma']);
  });

  it('video in two playlists sharing a member: union, deduplicated, self excluded, deleted/missing member skipped', async () => {
    await metadata.save(video('a', 'Alpha'));
    await metadata.save(video('b', 'Beta'));
    await metadata.save(video('c', 'Gamma'));
    await metadata.save(video('d', 'Delta'));
    // 'e' is a dangling reference (added then deleted)
    await metadata.save(video('e', 'Epsilon'));
    await playlist.create({ id: 'p1', name: 'P1', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', videoIds: ['a', 'b', 'e'] });
    await playlist.create({ id: 'p2', name: 'P2', created_at: '2025-01-02T00:00:00Z', updated_at: '2025-01-02T00:00:00Z', videoIds: ['b', 'c', 'd'] });
    await metadata.delete('e');

    // playlist.list() is newest-first (p2 before p1), so p2's members are
    // encountered ("first-seen") before p1's; 'e' is a dangling ref, skipped.
    expect(await collectPlaylistSiblingTitles({ playlist, metadata }, 'b')).toEqual(['Gamma', 'Delta', 'Alpha']);
  });

  it('video in no playlist returns []', async () => {
    await metadata.save(video('a', 'Alpha'));
    expect(await collectPlaylistSiblingTitles({ playlist, metadata }, 'a')).toEqual([]);
  });
});

describe('suggetVideoTitle', () => {
  let metadata: InMemoryMetadataStore;
  let playlist: InMemoryPlaylistStore;

  beforeEach(() => {
    metadata = new InMemoryMetadataStore();
    playlist = new InMemoryPlaylistStore();
  });

  it('no videoId: genAI is called with the filename and an empty sibling list', async () => {
    const genAI = fakeGenAI();
    const title = await suggetVideoTitle({ genAI, playlist, metadata }, 'clip.mp4');
    expect(title).toBe('Suggested');
    expect(genAI.calls).toEqual([{ filename: 'clip.mp4', playlistTitles: [] }]);
  });

  it('with videoId in a playlist: genAI is called with the sibling titles', async () => {
    await metadata.save(video('a', 'Alpha'));
    await metadata.save(video('b', 'Beta'));
    await playlist.create({ id: 'p1', name: 'P1', created_at: '2025-01-01T00:00:00Z', updated_at: '2025-01-01T00:00:00Z', videoIds: ['a', 'b'] });
    const genAI = fakeGenAI();

    await suggetVideoTitle({ genAI, playlist, metadata }, 'clip.mp4', 'a');
    expect(genAI.calls).toEqual([{ filename: 'clip.mp4', playlistTitles: ['Beta'] }]);
  });

  it('empty filename still throws IllegalArgumentError', async () => {
    const genAI = fakeGenAI();
    await expect(suggetVideoTitle({ genAI, playlist, metadata }, '  ')).rejects.toThrow(IllegalArgumentError);
  });
});
