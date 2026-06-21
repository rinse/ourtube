import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryMetadataStore } from './InMemoryMetadataStore';
import { VideoMetadata } from './VideoMetadata';

function video(id: string): VideoMetadata {
  return { id, title: `Title ${id}`, status: 'ready', created_at: '2025-01-01T00:00:00Z', has_thumbnail: false };
}

describe('InMemoryMetadataStore.getMany', () => {
  let store: InMemoryMetadataStore;

  beforeEach(() => {
    store = new InMemoryMetadataStore();
  });

  it('returns an empty array for empty input', async () => {
    expect(await store.getMany([])).toEqual([]);
  });

  it('returns only the videos that exist, dropping missing ids', async () => {
    await store.save(video('a'));
    await store.save(video('c'));
    const result = await store.getMany(['a', 'b', 'c']);
    expect(result.map((v) => v.id).sort()).toEqual(['a', 'c']);
  });

  it('returns an empty array when none of the ids exist', async () => {
    expect(await store.getMany(['x', 'y'])).toEqual([]);
  });

  it('tolerates duplicate ids in the input', async () => {
    await store.save(video('a'));
    const result = await store.getMany(['a', 'a']);
    expect(result.map((v) => v.id)).toEqual(['a', 'a']);
  });
});
