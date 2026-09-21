import { describe, it, expect, vi } from 'vitest';
import {
  ListObjectsV2Command,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import {
  chunkArray,
  listAllKeys,
  deleteByPrefix,
  type DeletePrefixS3Client,
} from './S3VideoStorage';

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
