import { describe, it, expect, beforeEach } from 'vitest';
import { createUpload } from './upload';
import { InMemoryMetadataStore } from '../metadata/InMemoryMetadataStore';
import { VideoStorage } from '../storage/VideoStorage';

const HASH = 'a'.repeat(64);

function fakeStorage(): VideoStorage {
  return {
    uploadKey: (id) => `uploads/${id}`,
    presignUpload: async (id) => `https://example.com/uploads/${id}?sig=test`,
    getFile: async () => { throw new Error('not implemented'); },
    getText: async () => '',
    presignGetFile: async (id, file) => `https://example.com/videos/${id}/${file}?sig=test`,
    existsFile: async () => false,
    exists: async () => false,
    delete: async () => true,
    downloadUpload: async () => {},
    deleteUpload: async () => {},
    uploadVideoDir: async () => {},
    normalizeThumbnail: async () => false,
  };
}

describe('createUpload', () => {
  let metadata: InMemoryMetadataStore;
  let storage: VideoStorage;

  beforeEach(() => {
    metadata = new InMemoryMetadataStore();
    storage = fakeStorage();
  });

  it('creates metadata and returns a presigned URL for a new video', async () => {
    const res = await createUpload({ storage, metadata }, { sha256: HASH, fileName: 'My Clip.mp4' });
    expect(res).not.toBeNull();
    expect(res!.videoId).toBe(HASH);
    expect(res!.title).toBe('My Clip');
    expect(res!.status).toBe('converting');
    expect(res!.uploadUrl).toContain(HASH);
    expect(await metadata.get(HASH)).not.toBeNull();
  });

  it('derives title from explicit input when given', async () => {
    const res = await createUpload({ storage, metadata }, { sha256: HASH, fileName: 'x.mp4', title: 'Custom' });
    expect(res!.title).toBe('Custom');
  });

  it('returns null (dedup) when the video already exists and is not failed', async () => {
    await createUpload({ storage, metadata }, { sha256: HASH, fileName: 'x.mp4' });
    const second = await createUpload({ storage, metadata }, { sha256: HASH, fileName: 'x.mp4' });
    expect(second).toBeNull();
  });

  it('allows re-upload when the previous attempt failed', async () => {
    await metadata.save({ id: HASH, title: 'Old', status: 'failed', created_at: new Date().toISOString(), has_thumbnail: false });
    const res = await createUpload({ storage, metadata }, { sha256: HASH, fileName: 'x.mp4' });
    expect(res).not.toBeNull();
  });

  it('rejects an invalid sha256', async () => {
    await expect(createUpload({ storage, metadata }, { sha256: 'nothex', fileName: 'x.mp4' }))
      .rejects.toThrow(/sha256/);
  });
});
