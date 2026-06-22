import { describe, it, expect } from 'vitest';
import { finalizeConversion } from './finalize';
import { InMemoryMetadataStore } from '../metadata/InMemoryMetadataStore';
import { VideoStorage } from '../storage/VideoStorage';

const ID = 'a'.repeat(64);

function storageWith(overrides: Partial<VideoStorage> = {}): VideoStorage {
  return {
    uploadKey: (id) => `uploads/${id}`,
    presignUpload: async () => 'put-url',
    getFile: async () => { throw new Error('no'); },
    getText: async () => '',
    presignGetFile: async (id, file) => `https://s3.test/videos/${id}/${file}?sig=abc`,
    existsFile: async () => true,
    exists: async () => true,
    delete: async () => true,
    downloadUpload: async () => {},
    deleteUpload: async () => {},
    uploadVideoDir: async () => {},
    normalizeThumbnail: async () => true,
    ...overrides,
  };
}

async function convertingVideo(): Promise<InMemoryMetadataStore> {
  const metadata = new InMemoryMetadataStore();
  await metadata.save({ id: ID, title: 't', status: 'converting', created_at: new Date().toISOString(), has_thumbnail: false });
  return metadata;
}

describe('finalizeConversion', () => {
  it('marks ready with thumbnail on first successful completion', async () => {
    const metadata = await convertingVideo();
    const storage = storageWith({ normalizeThumbnail: async () => true });

    await finalizeConversion({ storage, metadata }, ID, true);

    const after = await metadata.get(ID);
    expect(after?.status).toBe('ready');
    expect(after?.has_thumbnail).toBe(true);
  });

  it('marks failed when the manifest is missing', async () => {
    const metadata = await convertingVideo();
    const storage = storageWith({ existsFile: async () => false });

    await finalizeConversion({ storage, metadata }, ID, true);

    const after = await metadata.get(ID);
    expect(after?.status).toBe('failed');
  });

  it('marks failed when success=false', async () => {
    const metadata = await convertingVideo();
    const storage = storageWith();

    await finalizeConversion({ storage, metadata }, ID, false);

    const after = await metadata.get(ID);
    expect(after?.status).toBe('failed');
  });

  it('is idempotent: a duplicate COMPLETE event does not flip has_thumbnail to false', async () => {
    const metadata = await convertingVideo();
    let normalizeCalls = 0;
    const storage = storageWith({
      normalizeThumbnail: async () => {
        normalizeCalls += 1;
        // First call renames the captured frame -> true. A naive second call
        // (without the idempotency guard) would find nothing left to rename
        // and return false.
        return normalizeCalls === 1;
      },
    });

    await finalizeConversion({ storage, metadata }, ID, true);
    const afterFirst = await metadata.get(ID);
    expect(afterFirst?.status).toBe('ready');
    expect(afterFirst?.has_thumbnail).toBe(true);

    // Duplicate delivery of the same COMPLETE event.
    await finalizeConversion({ storage, metadata }, ID, true);
    const afterSecond = await metadata.get(ID);
    expect(afterSecond?.status).toBe('ready');
    expect(afterSecond?.has_thumbnail).toBe(true);
  });

  it('is idempotent: a duplicate event does not change a terminal failed state', async () => {
    const metadata = await convertingVideo();
    const storage = storageWith();

    await finalizeConversion({ storage, metadata }, ID, false);
    expect((await metadata.get(ID))?.status).toBe('failed');

    // Duplicate delivery, possibly with a different success flag.
    await finalizeConversion({ storage, metadata }, ID, true);
    expect((await metadata.get(ID))?.status).toBe('failed');
  });

  it('is a no-op when the record has been deleted (cancel-then-delete flow)', async () => {
    const metadata = new InMemoryMetadataStore();
    const storage = storageWith();

    // Record was deleted before the completion event arrived.
    await finalizeConversion({ storage, metadata }, ID, true);

    expect(await metadata.get(ID)).toBeNull();
  });
});
