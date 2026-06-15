import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { PlaylistStore } from './PlaylistStore';
import { Playlist, validatePlaylist, addMember, removeMember, reorderMembers } from './Playlist';
import { IllegalArgumentError } from '../utils';

/**
 * Single-table DynamoDB layout (see docs/dynamodb-schema.md):
 *
 *   Item (Playlist):  PK = PLAYLIST#<id>, SK = PLAYLIST#<id>
 *   GSI1 (newest-first list): GSI1PK = "PLAYLISTS", GSI1SK = "<created_at>#<id>"
 *
 * Reuses the existing GSI1 (videos sit under GSI1PK="VIDEOS", a disjoint
 * partition) so no schema/index change is required. `videoIds` is stored inline
 * on the item; member ops are read-modify-put — safe because this is a
 * single-user service (no concurrent writers to race).
 */
const GSI1_NAME = 'GSI1';
const LIST_PARTITION = 'PLAYLISTS';

function pk(id: string): string {
  return `PLAYLIST#${id}`;
}

function toItem(p: Playlist): Record<string, unknown> {
  return {
    PK: pk(p.id),
    SK: pk(p.id),
    GSI1PK: LIST_PARTITION,
    GSI1SK: `${p.created_at}#${p.id}`,
    id: p.id,
    name: p.name,
    created_at: p.created_at,
    updated_at: p.updated_at,
    videoIds: p.videoIds,
  };
}

export type DynamoPlaylistStoreConfig = {
  tableName: string;
  awsRegion: string;
  /** Custom endpoint for DynamoDB Local (e.g. http://localhost:8000). */
  endpoint?: string;
};

export class DynamoPlaylistStore implements PlaylistStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: DynamoPlaylistStoreConfig) {
    const client = new DynamoDBClient({
      region: config.awsRegion,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.tableName = config.tableName;
  }

  async create(playlist: Playlist): Promise<void> {
    await this.doc.send(new PutCommand({
      TableName: this.tableName,
      Item: toItem(playlist),
    }));
  }

  async get(id: string): Promise<Playlist | null> {
    const res = await this.doc.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: pk(id), SK: pk(id) },
    }));
    if (!res.Item) {
      return null;
    }
    return validatePlaylist({ ...res.Item, videoIds: res.Item.videoIds ?? [] });
  }

  async list(): Promise<Playlist[]> {
    const res = await this.doc.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :p',
      ExpressionAttributeValues: { ':p': LIST_PARTITION },
      ScanIndexForward: false, // newest first
    }));
    return (res.Items ?? [])
      .map((item) => validatePlaylist({ ...item, videoIds: item.videoIds ?? [] }))
      .filter((p): p is Playlist => p !== null);
  }

  async rename(id: string, name: string): Promise<boolean> {
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk(id), SK: pk(id) },
        UpdateExpression: 'SET #n = :n, updated_at = :u',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeNames: { '#n': 'name' },
        ExpressionAttributeValues: { ':n': name, ':u': new Date().toISOString() },
      }));
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }

  async delete(id: string): Promise<boolean> {
    const res = await this.doc.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: pk(id), SK: pk(id) },
      ReturnValues: 'ALL_OLD',
    }));
    return res.Attributes != null;
  }

  async addVideo(id: string, videoId: string): Promise<boolean> {
    return this.mutateMembers(id, (ids) => addMember(ids, videoId));
  }

  async removeVideo(id: string, videoId: string): Promise<boolean> {
    return this.mutateMembers(id, (ids) => removeMember(ids, videoId));
  }

  async reorder(id: string, videoIds: string[]): Promise<boolean> {
    return this.mutateMembers(id, (ids) => {
      const next = reorderMembers(ids, videoIds);
      if (next == null) {
        throw new IllegalArgumentError('videoIds must be a duplicate-free subset of the current members');
      }
      return next;
    });
  }

  /**
   * Read-modify-write of the `videoIds` array. Returns false if the playlist is
   * absent; the conditional write also guards against a delete racing in
   * (single-user, so this is belt-and-suspenders).
   */
  private async mutateMembers(id: string, transform: (ids: string[]) => string[]): Promise<boolean> {
    const existing = await this.get(id);
    if (existing == null) {
      return false;
    }
    const videoIds = transform(existing.videoIds);
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk(id), SK: pk(id) },
        UpdateExpression: 'SET videoIds = :v, updated_at = :u',
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: { ':v': videoIds, ':u': new Date().toISOString() },
      }));
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false;
      }
      throw error;
    }
  }
}
