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
    delete: async () => true,
    downloadUpload: async () => {},
    deleteUpload: async () => {},
    uploadVideoDir: async () => {},
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

function videoWith(overrides: Partial<VideoMetadata> = {}): VideoMetadata {
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
  it('cancels the in-flight conversion task, then drops the record and the source upload', async () => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save(videoWith({ converter_job_id: 'job-123' }));

    let cancelledJobId: string | null = null;
    const converter = converterWith({
      cancelJob: async (jobId) => { cancelledJobId = jobId; },
    });
    let uploadDeleted = false;
    const storage = storageWith({
      deleteUpload: async () => { uploadDeleted = true; },
    });

    const result = await deleteVideo({ storage, metadata, converter }, ID);

    expect(result).toBe(true);
    expect(cancelledJobId).toBe('job-123');
    expect(await metadata.get(ID)).toBeNull();
    expect(uploadDeleted).toBe(true);
  });

  // Only a `converting` record with a job id has a task left to stop: a stuck
  // upload never got one, and a finished video's id points at a long-gone task.
  it.each([
    ['converting, no job id', videoWith()],
    ['ready, stale job id', videoWith({ status: 'ready', converter_job_id: 'job-x' })],
  ])('deletes a video (%s) without calling cancelJob', async (_name, video) => {
    const metadata = new InMemoryMetadataStore();
    await metadata.save(video);

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

  it('returns false when the video does not exist', async () => {
    const metadata = new InMemoryMetadataStore();
    const converter = converterWith();

    const result = await deleteVideo(
      { storage: storageWith(), metadata, converter },
      ID,
    );

    expect(result).toBe(false);
  });
});
