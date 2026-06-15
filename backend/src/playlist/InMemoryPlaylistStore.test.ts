import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryPlaylistStore } from './InMemoryPlaylistStore';
import { Playlist } from './Playlist';
import { IllegalArgumentError } from '../utils';

function playlist(over: Partial<Playlist> = {}): Playlist {
  const now = new Date().toISOString();
  return { id: 'p1', name: 'List', created_at: now, updated_at: now, videoIds: [], ...over };
}

describe('InMemoryPlaylistStore', () => {
  let store: InMemoryPlaylistStore;

  beforeEach(() => {
    store = new InMemoryPlaylistStore();
  });

  it('creates and gets a playlist (returning a copy, not the stored ref)', async () => {
    await store.create(playlist({ videoIds: ['a'] }));
    const got = await store.get('p1');
    expect(got).not.toBeNull();
    got!.videoIds.push('mutate');
    expect((await store.get('p1'))!.videoIds).toEqual(['a']); // not affected
  });

  it('returns null for a missing playlist', async () => {
    expect(await store.get('nope')).toBeNull();
  });

  it('lists newest-first by created_at', async () => {
    await store.create(playlist({ id: 'old', created_at: '2024-01-01T00:00:00Z' }));
    await store.create(playlist({ id: 'new', created_at: '2025-01-01T00:00:00Z' }));
    const ids = (await store.list()).map((p) => p.id);
    expect(ids).toEqual(['new', 'old']);
  });

  it('renames and returns false when absent', async () => {
    await store.create(playlist({ name: 'Old' }));
    expect(await store.rename('p1', 'New')).toBe(true);
    expect((await store.get('p1'))!.name).toBe('New');
    expect(await store.rename('absent', 'X')).toBe(false);
  });

  it('deletes and returns false when absent', async () => {
    await store.create(playlist());
    expect(await store.delete('p1')).toBe(true);
    expect(await store.get('p1')).toBeNull();
    expect(await store.delete('p1')).toBe(false);
  });

  it('adds videos (dedup) and returns false when the playlist is absent', async () => {
    await store.create(playlist());
    expect(await store.addVideo('p1', 'a')).toBe(true);
    await store.addVideo('p1', 'b');
    await store.addVideo('p1', 'a'); // dedup
    expect((await store.get('p1'))!.videoIds).toEqual(['a', 'b']);
    expect(await store.addVideo('absent', 'a')).toBe(false);
  });

  it('removes videos and returns false when the playlist is absent', async () => {
    await store.create(playlist({ videoIds: ['a', 'b', 'c'] }));
    expect(await store.removeVideo('p1', 'b')).toBe(true);
    expect((await store.get('p1'))!.videoIds).toEqual(['a', 'c']);
    expect(await store.removeVideo('absent', 'a')).toBe(false);
  });

  it('reorders members', async () => {
    await store.create(playlist({ videoIds: ['a', 'b', 'c'] }));
    expect(await store.reorder('p1', ['c', 'a', 'b'])).toBe(true);
    expect((await store.get('p1'))!.videoIds).toEqual(['c', 'a', 'b']);
  });

  it('reorders a playlist that contains a deleted (dangling) video, preserving it', async () => {
    // 'x' is a dangling ref (deleted video). The UI reorders only [a, b].
    await store.create(playlist({ videoIds: ['a', 'x', 'b'] }));
    expect(await store.reorder('p1', ['b', 'a'])).toBe(true);
    expect((await store.get('p1'))!.videoIds).toEqual(['b', 'a', 'x']);
  });

  it('throws IllegalArgumentError on an invalid reorder payload', async () => {
    await store.create(playlist({ videoIds: ['a', 'b'] }));
    await expect(store.reorder('p1', ['a', 'z'])).rejects.toThrow(IllegalArgumentError);
  });

  it('returns false (not throw) on reorder when the playlist is absent', async () => {
    expect(await store.reorder('absent', [])).toBe(false);
  });
});
