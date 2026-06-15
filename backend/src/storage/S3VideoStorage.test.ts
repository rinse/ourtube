import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { S3VideoStorage } from './S3VideoStorage';

const VIDEO_ID = 'c'.repeat(64);

function makeStorage(): S3VideoStorage {
  return new S3VideoStorage({
    bucketName: 'test-bucket',
    awsRegion: 'us-east-1',
    forcePathStyle: true,
    uploadsPrefix: 'uploads/',
    videosPrefix: 'videos/',
    presignTtlSeconds: 60,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('S3VideoStorage.normalizeThumbnail', () => {
  it('renames a captured frame to thumbnail.jpg and returns true', async () => {
    const storage = makeStorage();
    const capturedKey = `videos/${VIDEO_ID}/thumb.0000001.jpg`;

    const send = vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: any) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [{ Key: capturedKey }] } as any;
      }
      if (command instanceof CopyObjectCommand || command instanceof DeleteObjectCommand) {
        return {} as any;
      }
      throw new Error(`unexpected command: ${command.constructor.name}`);
    });

    const result = await storage.normalizeThumbnail(VIDEO_ID);

    expect(result).toBe(true);
    const copyCall = send.mock.calls.find(([cmd]) => cmd instanceof CopyObjectCommand);
    expect(copyCall).toBeDefined();
    expect((copyCall![0] as CopyObjectCommand).input.Key).toBe(`videos/${VIDEO_ID}/thumbnail.jpg`);
    const deleteCall = send.mock.calls.find(([cmd]) => cmd instanceof DeleteObjectCommand);
    expect((deleteCall![0] as DeleteObjectCommand).input.Key).toBe(capturedKey);
  });

  it('is idempotent: returns true when thumbnail.jpg already exists and no frame capture is left', async () => {
    const storage = makeStorage();

    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: any) => {
      if (command instanceof ListObjectsV2Command) {
        // No leftover frame-capture files (already renamed by a prior run).
        return { Contents: [] } as any;
      }
      if (command instanceof HeadObjectCommand) {
        // Canonical thumbnail.jpg already exists.
        expect(command.input.Key).toBe(`videos/${VIDEO_ID}/thumbnail.jpg`);
        return {} as any;
      }
      throw new Error(`unexpected command: ${command.constructor.name}`);
    });

    const result = await storage.normalizeThumbnail(VIDEO_ID);

    expect(result).toBe(true);
  });

  it('returns false when there is no captured frame and no thumbnail.jpg', async () => {
    const storage = makeStorage();

    vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: any) => {
      if (command instanceof ListObjectsV2Command) {
        return { Contents: [] } as any;
      }
      if (command instanceof HeadObjectCommand) {
        throw new Error('NotFound');
      }
      throw new Error(`unexpected command: ${command.constructor.name}`);
    });

    const result = await storage.normalizeThumbnail(VIDEO_ID);

    expect(result).toBe(false);
  });
});
