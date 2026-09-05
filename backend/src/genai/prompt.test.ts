import { describe, it, expect, beforeEach } from 'vitest';
import { buildTitleUserPrompt } from './prompt';
import { InMemoryMetadataStore } from '../metadata/InMemoryMetadataStore';
import { VideoMetadata } from '../metadata/VideoMetadata';

function video(id: string, title: string): VideoMetadata {
  return { id, title, status: 'ready', created_at: '2025-01-01T00:00:00Z', has_thumbnail: false };
}

// The exact string the pre-change buildTitleUserPrompt(metadata, filename) produced.
function oldPrompt(titles: string[], filename: string): string {
  return `Filename: ${filename}.
    Existing video titles in the library:
    ${titles.length > 0 ? titles.map((t) => `- ${t}`).join('\n') : '(No existing videos yet)'}`;
}

describe('buildTitleUserPrompt', () => {
  let metadata: InMemoryMetadataStore;

  beforeEach(() => {
    metadata = new InMemoryMetadataStore();
  });

  it('with no library videos and no playlist titles, output is byte-for-byte identical to the pre-change output', async () => {
    const actual = await buildTitleUserPrompt(metadata, 'clip.mp4', []);
    expect(actual).toBe(oldPrompt([], 'clip.mp4'));
  });

  it('with library videos and no playlist titles, output is byte-for-byte identical to the pre-change output', async () => {
    // distinct created_at so InMemoryMetadataStore's newest-first list() order is deterministic
    await metadata.save({ ...video('a', 'Alpha'), created_at: '2025-01-01T00:00:00Z' });
    await metadata.save({ ...video('b', 'Beta'), created_at: '2025-01-02T00:00:00Z' });
    const actual = await buildTitleUserPrompt(metadata, 'clip.mp4', []);
    expect(actual).toBe(oldPrompt(['Beta', 'Alpha'], 'clip.mp4'));
  });

  it('with playlist titles, the playlist section appears before the library section', async () => {
    await metadata.save(video('a', 'Alpha'));
    const actual = await buildTitleUserPrompt(metadata, 'clip.mp4', ['Series 01', 'Series 02']);

    const playlistIdx = actual.indexOf('Titles of the other videos in the same playlist');
    const libraryIdx = actual.indexOf('Existing video titles in the library');
    expect(playlistIdx).toBeGreaterThan(-1);
    expect(libraryIdx).toBeGreaterThan(-1);
    expect(playlistIdx).toBeLessThan(libraryIdx);
    expect(actual).toContain('- Series 01');
    expect(actual).toContain('- Series 02');
    expect(actual).toContain('- Alpha');
  });
});
