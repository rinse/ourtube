import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  DynamoDBDocumentClient,
  GetCommand,
  BatchGetCommand,
  PutCommand,
  DeleteCommand,
  UpdateCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import { MetadataStore } from './MetadataStore';
import { VideoMetadata, VideoStatus, validateVideoMetadata } from './VideoMetadata';

/**
 * Single-table DynamoDB layout (see docs/dynamodb-schema.md):
 *
 *   Item (Video):  PK = VIDEO#<id>, SK = VIDEO#<id>
 *   GSI1 (newest-first list): GSI1PK = "VIDEOS", GSI1SK = "<created_at>#<id>"
 *
 * The domain attributes (id/title/status/created_at/has_thumbnail) are stored
 * alongside the keys; keys are stripped before validation/return.
 */
const GSI1_NAME = 'GSI1';
const LIST_PARTITION = 'VIDEOS';
/** Hard limit imposed by DynamoDB's BatchGetItem (per call, across all tables). */
const BATCH_GET_LIMIT = 100;

function pk(id: string): string {
  return `VIDEO#${id}`;
}

function toItem(m: VideoMetadata): Record<string, unknown> {
  return {
    PK: pk(m.id),
    SK: pk(m.id),
    GSI1PK: LIST_PARTITION,
    GSI1SK: `${m.created_at}#${m.id}`,
    id: m.id,
    title: m.title,
    status: m.status,
    created_at: m.created_at,
    has_thumbnail: m.has_thumbnail,
  };
}

export type DynamoMetadataStoreConfig = {
  tableName: string;
  awsRegion: string;
  /** Custom endpoint for DynamoDB Local (e.g. http://localhost:8000). */
  endpoint?: string;
};

export class DynamoMetadataStore implements MetadataStore {
  private readonly doc: DynamoDBDocumentClient;
  private readonly tableName: string;

  constructor(config: DynamoMetadataStoreConfig) {
    const client = new DynamoDBClient({
      region: config.awsRegion,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
    this.doc = DynamoDBDocumentClient.from(client, {
      marshallOptions: { removeUndefinedValues: true },
    });
    this.tableName = config.tableName;
  }

  async get(videoId: string): Promise<VideoMetadata | null> {
    const res = await this.doc.send(new GetCommand({
      TableName: this.tableName,
      Key: { PK: pk(videoId), SK: pk(videoId) },
    }));
    if (!res.Item) {
      return null;
    }
    return validateVideoMetadata(res.Item);
  }

  async getMany(ids: string[]): Promise<VideoMetadata[]> {
    // BatchGetItem rejects duplicate keys within a single request, and a
    // dedicated request for the same id twice would be wasted work anyway.
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) {
      return [];
    }
    const results: VideoMetadata[] = [];
    for (let i = 0; i < uniqueIds.length; i += BATCH_GET_LIMIT) {
      const chunk = uniqueIds.slice(i, i + BATCH_GET_LIMIT);
      results.push(...await this.batchGetChunk(chunk));
    }
    return results;
  }

  /** Fetches at most BATCH_GET_LIMIT keys, retrying any UnprocessedKeys. */
  private async batchGetChunk(ids: string[]): Promise<VideoMetadata[]> {
    let keys = ids.map((id) => ({ PK: pk(id), SK: pk(id) }));
    const items: Record<string, unknown>[] = [];
    while (keys.length > 0) {
      const res = await this.doc.send(new BatchGetCommand({
        RequestItems: {
          [this.tableName]: { Keys: keys },
        },
      }));
      items.push(...(res.Responses?.[this.tableName] ?? []));
      keys = (res.UnprocessedKeys?.[this.tableName]?.Keys ?? []) as { PK: string; SK: string }[];
    }
    return items
      .map((item) => validateVideoMetadata(item))
      .filter((v): v is VideoMetadata => v !== null);
  }

  async list(): Promise<VideoMetadata[]> {
    const res = await this.doc.send(new QueryCommand({
      TableName: this.tableName,
      IndexName: GSI1_NAME,
      KeyConditionExpression: 'GSI1PK = :p',
      ExpressionAttributeValues: { ':p': LIST_PARTITION },
      ScanIndexForward: false, // newest first
    }));
    return (res.Items ?? [])
      .map((item) => validateVideoMetadata(item))
      .filter((v): v is VideoMetadata => v !== null);
  }

  async save(metadata: VideoMetadata): Promise<void> {
    await this.doc.send(new PutCommand({
      TableName: this.tableName,
      Item: toItem(metadata),
    }));
  }

  async delete(videoId: string): Promise<boolean> {
    const res = await this.doc.send(new DeleteCommand({
      TableName: this.tableName,
      Key: { PK: pk(videoId), SK: pk(videoId) },
      ReturnValues: 'ALL_OLD',
    }));
    return res.Attributes != null;
  }

  async updateTitle(videoId: string, title: string): Promise<boolean> {
    return this.update(videoId, 'SET title = :t', { ':t': title });
  }

  async updateStatus(videoId: string, status: VideoStatus): Promise<boolean> {
    return this.update(videoId, 'SET #s = :s', { ':s': status }, { '#s': 'status' });
  }

  async updateThumbnail(videoId: string, hasThumbnail: boolean): Promise<boolean> {
    return this.update(videoId, 'SET has_thumbnail = :h', { ':h': hasThumbnail });
  }

  private async update(
    videoId: string,
    updateExpression: string,
    values: Record<string, unknown>,
    names?: Record<string, string>,
  ): Promise<boolean> {
    try {
      await this.doc.send(new UpdateCommand({
        TableName: this.tableName,
        Key: { PK: pk(videoId), SK: pk(videoId) },
        UpdateExpression: updateExpression,
        ConditionExpression: 'attribute_exists(PK)',
        ExpressionAttributeValues: values,
        ...(names ? { ExpressionAttributeNames: names } : {}),
      }));
      return true;
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'ConditionalCheckFailedException') {
        return false; // no such video
      }
      throw error;
    }
  }
}
