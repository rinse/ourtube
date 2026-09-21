import { describe, it, expect } from 'vitest';
import { markConversionFailed } from './finalize';
import { InMemoryMetadataStore } from '../metadata/InMemoryMetadataStore';
import { VideoStorage } from '../storage/VideoStorage';

const ID = 'a'.repeat(64);

function storageWith(overrides: Partial<VideoStorage> = {}): VideoStorage {
  return {
    uploadKey: (id) => `uploads/${id}`,
    presignUpload: async () => 'put-url',
    getFile: async () => { throw new Error('no'); },
    getText: async () => { throw new Error('no'); },
    presignGetFile: async (id, file) => `https://s3.test/videos/${id}/${file}?sig=abc`,
    existsFile: async () => true,
    delete: async () => true,
    downloadUpload: async () => {},
    deleteUpload: async () => {},
    uploadVideoDir: async () => {},
    ...overrides,
  };
}

async function videoWith(status: 'converting' | 'ready' | 'failed', hasThumbnail = false): Promise<InMemoryMetadataStore> {
  const metadata = new InMemoryMetadataStore();
  await metadata.save({ id: ID, title: 't', status, created_at: new Date().toISOString(), has_thumbnail: hasThumbnail });
  return metadata;
}

describe('markConversionFailed', () => {
  it('marks a converting video failed and deletes the source upload', async () => {
    const metadata = await videoWith('converting');
    let deleted = false;
    const storage = storageWith({ deleteUpload: async () => { deleted = true; } });

    await markConversionFailed({ storage, metadata }, ID);

    expect((await metadata.get(ID))?.status).toBe('failed');
    expect(deleted).toBe(true);
  });

  it('still marks failed when deleting the source upload throws', async () => {
    const metadata = await videoWith('converting');
    const storage = storageWith({ deleteUpload: async () => { throw new Error('s3 down'); } });

    await markConversionFailed({ storage, metadata }, ID);

    expect((await metadata.get(ID))?.status).toBe('failed');
  });

  it('does not throw when the record is already gone (cancel-then-delete)', async () => {
    const metadata = new InMemoryMetadataStore();
    let deleted = false;
    const storage = storageWith({ deleteUpload: async () => { deleted = true; } });

    await expect(markConversionFailed({ storage, metadata }, ID)).resolves.toBeUndefined();

    expect(deleted).toBe(false);
  });

  it.each(['ready', 'failed'] as const)('is a no-op on a video already finalized as %s', async (status) => {
    const metadata = await videoWith(status, true);
    let deleted = false;
    const storage = storageWith({ deleteUpload: async () => { deleted = true; } });

    await markConversionFailed({ storage, metadata }, ID);

    const after = await metadata.get(ID);
    expect(after?.status).toBe(status);
    expect(after?.has_thumbnail).toBe(true);
    expect(deleted).toBe(false);
  });
});
