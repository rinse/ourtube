import { describe, it, expect } from 'vitest';
import { deleteVideo } from './delete';
import { InMemoryMetadataStore } from '../../../metadata/InMemoryMetadataStore';
import { VideoStorage } from '../../../storage/VideoStorage';
import { Converter, ConversionResult } from '../../../converter/Converter';
import { VideoMetadata } from '../../../metadata/VideoMetadata';

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

function converterWith(overrides: Partial<Converter> = {}): Converter {
  return {
    startConversion: async (): Promise<ConversionResult> => ({}),
    cancelJob: async () => {},
    ...overrides,
  };
}

function convertingVideo(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
  return {
    id: ID,
    title: 'test',
    status: 'converting',
    created_at: new Date().toISOString(),
    has_thumbnail: false,
    ...overrides,
  };
}

describe('deleteVideo', () => {
  it('cancels MediaConvert job before deleting when converter_job_id is present', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save(convertingVideo({ converter_job_id: 'job-123' }));

    let cancelledJobId: string | null = null;
    const converter = converterWith({
      cancelJob: async (jobId) => { cancelledJobId = jobId; },
    });

    const result = await deleteVideo(
      { storage: storageWith(), metadata, converter },
      ID,
    );

    expect(result).toBe(true);
    expect(cancelledJobId).toBe('job-123');
    expect(await metadata.get(ID)).toBeNull();
  });

  it('does not call cancelJob when converter_job_id is absent (stuck/no job)', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save(convertingVideo());

    let cancelCalled = false;
    const converter = converterWith({
      cancelJob: async () => { cancelCalled = true; },
    });

    const result = await deleteVideo(
      { storage: storageWith(), metadata, converter },
      ID,
    );

    expect(result).toBe(true);
    expect(cancelCalled).toBe(false);
    expect(await metadata.get(ID)).toBeNull();
  });

  it('deletes a ready video without calling cancelJob', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save({ ...convertingVideo(), status: 'ready' });

    let cancelCalled = false;
    const converter = converterWith({
      cancelJob: async () => { cancelCalled = true; },
    });

    const result = await deleteVideo(
      { storage: storageWith(), metadata, converter },
      ID,
    );

    expect(result).toBe(true);
    expect(cancelCalled).toBe(false);
  });

  it('returns false when the video does not exist', async () => {
    const metadata = new InMemoryMetadataStore();
    const converter = converterWith();

    const result = await deleteVideo(
      { storage: storageWith(), metadata, converter },
      ID,
    );

    expect(result).toBe(false);
  });

  it('cleans up the source upload alongside video files', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save(convertingVideo({ converter_job_id: 'job-456' }));

    let uploadDeleted = false;
    const storage = storageWith({
      deleteUpload: async () => { uploadDeleted = true; },
    });
    const converter = converterWith();

    await deleteVideo({ storage, metadata, converter }, ID);

    expect(uploadDeleted).toBe(true);
  });
});
