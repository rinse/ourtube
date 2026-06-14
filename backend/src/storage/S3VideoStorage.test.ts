import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  S3VideoStorage,
  chunkArray,
  listAllKeys,
  deleteByPrefix,
  type DeletePrefixS3Client,
} from './S3VideoStorage';

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

describe('chunkArray', () => {
  it('returns a single chunk when items fit within the chunk size', () => {
    const items = Array.from({ length: 1000 }, (_, i) => i);
    expect(chunkArray(items, 1000)).toEqual([items]);
  });

  it('splits into two chunks when one item exceeds the chunk size', () => {
    const items = Array.from({ length: 1001 }, (_, i) => i);
    const chunks = chunkArray(items, 1000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1000);
    expect(chunks[1]).toHaveLength(1);
  });

  it('splits exactly in half when items are double the chunk size', () => {
    const items = Array.from({ length: 2000 }, (_, i) => i);
    const chunks = chunkArray(items, 1000);
    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(1000);
    expect(chunks[1]).toHaveLength(1000);
  });

  it('returns an empty array for empty input', () => {
    expect(chunkArray([], 1000)).toEqual([]);
  });
});

describe('listAllKeys', () => {
  it('collects keys across multiple pages following NextContinuationToken', async () => {
    const send = vi.fn();
    send.mockImplementationOnce(async () => ({
      Contents: [{ Key: 'a' }, { Key: 'b' }],
      IsTruncated: true,
      NextContinuationToken: 'token-1',
    }));
    send.mockImplementationOnce(async () => ({
      Contents: [{ Key: 'c' }],
      IsTruncated: false,
    }));
    const s3: DeletePrefixS3Client = { send };

    const keys = await listAllKeys(s3, 'bucket', 'videos/abc/');

    expect(keys).toEqual(['a', 'b', 'c']);
    expect(send).toHaveBeenCalledTimes(2);

    const secondCall = send.mock.calls[1][0] as ListObjectsV2Command;
    expect(secondCall.input.ContinuationToken).toBe('token-1');
  });

  it('returns an empty array when there are no objects', async () => {
    const send = vi.fn(async () => ({ Contents: [], IsTruncated: false }));
    const s3: DeletePrefixS3Client = { send };

    const keys = await listAllKeys(s3, 'bucket', 'videos/empty/');

    expect(keys).toEqual([]);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe('deleteByPrefix', () => {
  it('does nothing when the prefix has no objects', async () => {
    const send = vi.fn(async () => ({ Contents: [], IsTruncated: false }));
    const s3: DeletePrefixS3Client = { send };

    await deleteByPrefix(s3, 'bucket', 'videos/empty/');

    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toBeInstanceOf(ListObjectsV2Command);
  });

  it('paginates listing and issues a single DeleteObjects call for <=1000 keys', async () => {
    const send = vi.fn();
    send.mockImplementationOnce(async () => ({
      Contents: Array.from({ length: 500 }, (_, i) => ({ Key: `videos/abc/seg-${i}.ts` })),
      IsTruncated: true,
      NextContinuationToken: 'token-1',
    }));
    send.mockImplementationOnce(async () => ({
      Contents: Array.from({ length: 500 }, (_, i) => ({ Key: `videos/abc/seg-${500 + i}.ts` })),
      IsTruncated: false,
    }));
    send.mockImplementationOnce(async () => ({}));
    const s3: DeletePrefixS3Client = { send };

    await deleteByPrefix(s3, 'bucket', 'videos/abc/');

    expect(send).toHaveBeenCalledTimes(3);
    const deleteCall = send.mock.calls[2][0] as DeleteObjectsCommand;
    expect(deleteCall).toBeInstanceOf(DeleteObjectsCommand);
    expect(deleteCall.input.Delete?.Objects).toHaveLength(1000);
  });

  it('splits more than 1000 keys across multiple DeleteObjects calls', async () => {
    const send = vi.fn();
    send.mockImplementationOnce(async () => ({
      Contents: Array.from({ length: 1001 }, (_, i) => ({ Key: `videos/abc/seg-${i}.ts` })),
      IsTruncated: false,
    }));
    send.mockImplementationOnce(async () => ({}));
    send.mockImplementationOnce(async () => ({}));
    const s3: DeletePrefixS3Client = { send };

    await deleteByPrefix(s3, 'bucket', 'videos/abc/');

    // 1 list call + 2 delete calls (1000 + 1)
    expect(send).toHaveBeenCalledTimes(3);

    const firstDelete = send.mock.calls[1][0] as DeleteObjectsCommand;
    const secondDelete = send.mock.calls[2][0] as DeleteObjectsCommand;
    expect(firstDelete).toBeInstanceOf(DeleteObjectsCommand);
    expect(secondDelete).toBeInstanceOf(DeleteObjectsCommand);
    expect(firstDelete.input.Delete?.Objects).toHaveLength(1000);
    expect(secondDelete.input.Delete?.Objects).toHaveLength(1);
  });
});
