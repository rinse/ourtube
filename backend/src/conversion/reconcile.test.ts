import { describe, it, expect } from 'vitest';
import { reconcileStuckConversions } from './reconcile';
import { InMemoryMetadataStore } from '../metadata/InMemoryMetadataStore';
import { VideoMetadata } from '../metadata/VideoMetadata';

function video(overrides: Partial<VideoMetadata> & { id: string }): VideoMetadata {
  return {
    title: 'test',
    status: 'converting',
    created_at: '2026-06-20T00:00:00.000Z',
    has_thumbnail: false,
    ...overrides,
  };
}

const NOW = new Date('2026-06-22T12:00:00.000Z');
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

describe('reconcileStuckConversions', () => {
  it('marks converting videos older than the threshold as failed', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save(video({ id: 'stuck-1', created_at: '2026-06-20T00:00:00.000Z' }));

    const result = await reconcileStuckConversions({ metadata }, { now: NOW });

    expect(result.recovered).toEqual(['stuck-1']);
    expect((await metadata.get('stuck-1'))?.status).toBe('failed');
  });

  it('does not touch converting videos within the threshold', async () => {
    const metadata = new InMemoryMetadataStore();
    const recentTime = new Date(NOW.getTime() - TWO_HOURS_MS + 60_000).toISOString();
    await metadata.save(video({ id: 'recent', created_at: recentTime }));

    const result = await reconcileStuckConversions({ metadata }, { now: NOW });

    expect(result.recovered).toEqual([]);
    expect((await metadata.get('recent'))?.status).toBe('converting');
  });

  it('does not touch ready or failed videos', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save(video({ id: 'ready-1', status: 'ready', created_at: '2026-06-01T00:00:00.000Z' }));
    await metadata.save(video({ id: 'failed-1', status: 'failed', created_at: '2026-06-01T00:00:00.000Z' }));

    const result = await reconcileStuckConversions({ metadata }, { now: NOW });

    expect(result.recovered).toEqual([]);
    expect((await metadata.get('ready-1'))?.status).toBe('ready');
    expect((await metadata.get('failed-1'))?.status).toBe('failed');
  });

  it('recovers multiple stuck videos in one sweep', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save(video({ id: 'stuck-a', created_at: '2026-06-19T00:00:00.000Z' }));
    await metadata.save(video({ id: 'stuck-b', created_at: '2026-06-20T00:00:00.000Z' }));
    await metadata.save(video({ id: 'recent', created_at: NOW.toISOString() }));
    await metadata.save(video({ id: 'ready-1', status: 'ready', created_at: '2026-06-18T00:00:00.000Z' }));

    const result = await reconcileStuckConversions({ metadata }, { now: NOW });

    expect(result.scanned).toBe(4);
    expect(result.recovered.sort()).toEqual(['stuck-a', 'stuck-b']);
    expect((await metadata.get('recent'))?.status).toBe('converting');
    expect((await metadata.get('ready-1'))?.status).toBe('ready');
  });

  it('respects a custom threshold', async () => {
    const metadata = new InMemoryMetadataStore();
    const oneHourAgo = new Date(NOW.getTime() - 60 * 60 * 1000 - 1000).toISOString();
    await metadata.save(video({ id: 'v1', created_at: oneHourAgo }));

    const defaultResult = await reconcileStuckConversions({ metadata }, { now: NOW });
    expect(defaultResult.recovered).toEqual([]);

    const customResult = await reconcileStuckConversions(
      { metadata },
      { now: NOW, thresholdMs: 60 * 60 * 1000 },
    );
    expect(customResult.recovered).toEqual(['v1']);
  });

  it('returns empty when there are no videos', async () => {
    const metadata = new InMemoryMetadataStore();

    const result = await reconcileStuckConversions({ metadata }, { now: NOW });

    expect(result.scanned).toBe(0);
    expect(result.recovered).toEqual([]);
  });
});
