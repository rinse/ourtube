import { describe, it, expect, beforeAll, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  DynamoDBClient,
  CreateTableCommand,
  DescribeTableCommand,
  ResourceInUseException,
} from '@aws-sdk/client-dynamodb';
import { DynamoPlaylistStore } from './DynamoPlaylistStore';
import { Playlist } from './Playlist';
import { IllegalArgumentError } from '../utils';

/**
 * Integration test against DynamoDB Local. Runs only when DYNAMODB_ENDPOINT is
 * set (e.g. `docker compose up dynamodb-local dynamodb-init` then
 * `DYNAMODB_ENDPOINT=http://localhost:8000 npm test`). It auto-skips otherwise,
 * matching the repo's posture — CI has no DynamoDB Local, so the unit tests on
 * the in-memory fake carry CI coverage. See README/PR notes.
 */
const ENDPOINT = process.env.DYNAMODB_ENDPOINT;
const TABLE = process.env.DYNAMODB_TABLE ?? 'videoplayer';
const REGION = process.env.AWS_REGION ?? 'ap-northeast-1';

async function ensureTable(client: DynamoDBClient): Promise<void> {
  try {
    await client.send(new CreateTableCommand({
      TableName: TABLE,
      AttributeDefinitions: [
        { AttributeName: 'PK', AttributeType: 'S' },
        { AttributeName: 'SK', AttributeType: 'S' },
        { AttributeName: 'GSI1PK', AttributeType: 'S' },
        { AttributeName: 'GSI1SK', AttributeType: 'S' },
      ],
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [{
        IndexName: 'GSI1',
        KeySchema: [
          { AttributeName: 'GSI1PK', KeyType: 'HASH' },
          { AttributeName: 'GSI1SK', KeyType: 'RANGE' },
        ],
        Projection: { ProjectionType: 'ALL' },
      }],
      BillingMode: 'PAY_PER_REQUEST',
    }));
  } catch (error) {
    if (!(error instanceof ResourceInUseException)) {
      throw error;
    }
  }
  await client.send(new DescribeTableCommand({ TableName: TABLE }));
}

function playlist(over: Partial<Playlist> = {}): Playlist {
  const now = new Date().toISOString();
  return { id: randomUUID(), name: 'List', created_at: now, updated_at: now, videoIds: [], ...over };
}

describe.skipIf(!ENDPOINT)('DynamoPlaylistStore (DynamoDB Local)', () => {
  let store: DynamoPlaylistStore;

  beforeAll(async () => {
    const client = new DynamoDBClient({ region: REGION, endpoint: ENDPOINT });
    await ensureTable(client);
  });

  beforeEach(() => {
    store = new DynamoPlaylistStore({ tableName: TABLE, awsRegion: REGION, endpoint: ENDPOINT });
  });

  it('round-trips create → get', async () => {
    const p = playlist({ name: 'Trip', videoIds: ['a', 'b'] });
    await store.create(p);
    const got = await store.get(p.id);
    expect(got).not.toBeNull();
    expect(got!.name).toBe('Trip');
    expect(got!.videoIds).toEqual(['a', 'b']);
  });

  it('lists newest-first via GSI1', async () => {
    const older = playlist({ created_at: '2020-01-01T00:00:00.000Z' });
    const newer = playlist({ created_at: '2030-01-01T00:00:00.000Z' });
    await store.create(older);
    await store.create(newer);
    const ids = (await store.list()).map((p) => p.id);
    expect(ids.indexOf(newer.id)).toBeLessThan(ids.indexOf(older.id));
  });

  it('renames; returns false when absent', async () => {
    const p = playlist();
    await store.create(p);
    expect(await store.rename(p.id, 'Renamed')).toBe(true);
    expect((await store.get(p.id))!.name).toBe('Renamed');
    expect(await store.rename(randomUUID(), 'X')).toBe(false);
  });

  it('adds (dedup) / removes / reorders members, preserving dangling refs', async () => {
    const p = playlist();
    await store.create(p);
    await store.addVideo(p.id, 'a');
    await store.addVideo(p.id, 'b');
    await store.addVideo(p.id, 'a'); // dedup
    await store.addVideo(p.id, 'x'); // becomes a dangling ref below
    expect((await store.get(p.id))!.videoIds).toEqual(['a', 'b', 'x']);

    expect(await store.removeVideo(p.id, 'b')).toBe(true);
    expect((await store.get(p.id))!.videoIds).toEqual(['a', 'x']);

    await store.addVideo(p.id, 'b');
    // UI reorders only the visible [a, b]; dangling 'x' must survive.
    expect(await store.reorder(p.id, ['b', 'a'])).toBe(true);
    expect((await store.get(p.id))!.videoIds).toEqual(['b', 'a', 'x']);
  });

  it('throws on invalid reorder; returns false when absent', async () => {
    const p = playlist({ videoIds: ['a'] });
    await store.create(p);
    await expect(store.reorder(p.id, ['a', 'z'])).rejects.toThrow(IllegalArgumentError);
    expect(await store.reorder(randomUUID(), [])).toBe(false);
  });

  it('deletes; returns false when absent', async () => {
    const p = playlist();
    await store.create(p);
    expect(await store.delete(p.id)).toBe(true);
    expect(await store.get(p.id)).toBeNull();
    expect(await store.delete(p.id)).toBe(false);
  });
});
