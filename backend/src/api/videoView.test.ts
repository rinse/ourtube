import { describe, it, expect } from 'vitest';
import { toVideoItem } from './videoView';
import { AppConfig } from '../config';
import { VideoMetadata } from '../metadata/VideoMetadata';

// toVideoItem ignores config, so an empty cast is sufficient for these tests.
const config = {} as AppConfig;

function video(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    id: 'a'.repeat(64),
    title: 't',
    status: 'ready',
    created_at: '2025-01-01T00:00:00Z',
    has_thumbnail: false,
    ...overrides,
  };
}

describe('toVideoItem', () => {
  it('includes duration when set on the metadata record', () => {
    const item = toVideoItem(config, video({ duration: 123.4 }));
    expect(item.duration).toBe(123.4);
  });

  it('omits duration when not yet computed (e.g. still converting)', () => {
    const item = toVideoItem(config, video({ status: 'converting' }));
    expect(item.duration).toBeUndefined();
  });
});
