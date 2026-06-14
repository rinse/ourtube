import {
  S3Client,
  HeadObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  ListObjectsV2Command,
  DeleteObjectsCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { pipeline } from 'stream/promises';
import { VideoStorage } from './VideoStorage';
import { getMimeType } from '../media/ffmpeg';

const fsReaddir = promisify(fs.readdir);

export type S3VideoStorageConfig = {
  bucketName: string;
  awsRegion: string;
  endpoint?: string;
  forcePathStyle: boolean;
  uploadsPrefix: string;
  videosPrefix: string;
  presignTtlSeconds: number;
};

export class S3VideoStorage implements VideoStorage {
  private readonly s3: S3Client;
  private readonly cfg: S3VideoStorageConfig;

  constructor(config: S3VideoStorageConfig) {
    this.cfg = config;
    this.s3 = new S3Client({
      region: config.awsRegion,
      forcePathStyle: config.forcePathStyle,
      ...(config.endpoint ? { endpoint: config.endpoint } : {}),
    });
  }

  private videoKey(videoId: string, filename: string): string {
    return `${this.cfg.videosPrefix}${videoId}/${filename}`;
  }

  uploadKey(videoId: string): string {
    return `${this.cfg.uploadsPrefix}${videoId}`;
  }

  async getFile(videoId: string, filename: string): Promise<{ stream: Readable; mime: string }> {
    const res = await this.s3.send(new GetObjectCommand({
      Bucket: this.cfg.bucketName,
      Key: this.videoKey(videoId, filename),
    }));
    if (!res.Body) {
      throw new Error(`File not found: ${filename}`);
    }
    return { stream: res.Body as Readable, mime: getMimeType(filename) };
  }

  async getText(videoId: string, filename: string): Promise<string> {
    const res = await this.s3.send(new GetObjectCommand({
      Bucket: this.cfg.bucketName,
      Key: this.videoKey(videoId, filename),
    }));
    if (!res.Body) {
      throw new Error(`File not found: ${filename}`);
    }
    return res.Body.transformToString();
  }

  async presignGetFile(videoId: string, filename: string): Promise<string> {
    const command = new GetObjectCommand({
      Bucket: this.cfg.bucketName,
      Key: this.videoKey(videoId, filename),
    });
    return getSignedUrl(this.s3, command, { expiresIn: this.cfg.presignTtlSeconds });
  }

  async existsFile(videoId: string, filename: string): Promise<boolean> {
    return this.head(this.videoKey(videoId, filename));
  }

  async exists(videoId: string): Promise<boolean> {
    return this.head(this.videoKey(videoId, 'index.m3u8'));
  }

  async delete(videoId: string): Promise<boolean> {
    try {
      const prefix = `${this.cfg.videosPrefix}${videoId}/`;
      await deleteByPrefix(this.s3, this.cfg.bucketName, prefix);
      return true;
    } catch (error) {
      console.error(`Failed to delete video ${videoId} from S3:`, error);
      return false;
    }
  }

  async presignUpload(videoId: string, contentType?: string): Promise<string> {
    const command = new PutObjectCommand({
      Bucket: this.cfg.bucketName,
      Key: this.uploadKey(videoId),
      ...(contentType ? { ContentType: contentType } : {}),
    });
    return getSignedUrl(this.s3, command, { expiresIn: this.cfg.presignTtlSeconds });
  }

  async downloadUpload(videoId: string, destPath: string): Promise<void> {
    const res = await this.s3.send(new GetObjectCommand({
      Bucket: this.cfg.bucketName,
      Key: this.uploadKey(videoId),
    }));
    if (!res.Body) {
      throw new Error(`Upload not found for ${videoId}`);
    }
    await pipeline(res.Body as Readable, fs.createWriteStream(destPath));
  }

  async deleteUpload(videoId: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({
      Bucket: this.cfg.bucketName,
      Key: this.uploadKey(videoId),
    }));
  }

  async uploadVideoDir(videoId: string, localDir: string): Promise<void> {
    const files = await fsReaddir(localDir);
    await Promise.all(files.map(async (filename) => {
      const upload = new Upload({
        client: this.s3,
        params: {
          Bucket: this.cfg.bucketName,
          Key: this.videoKey(videoId, filename),
          Body: fs.createReadStream(path.join(localDir, filename)),
          ContentType: getMimeType(filename),
        },
      });
      await upload.done();
    }));
  }

  async normalizeThumbnail(videoId: string): Promise<boolean> {
    const prefix = `${this.cfg.videosPrefix}${videoId}/`;
    const listed = await this.s3.send(new ListObjectsV2Command({
      Bucket: this.cfg.bucketName,
      Prefix: `${prefix}thumb`,
    }));
    const captured = (listed.Contents ?? [])
      .map((o) => o.Key!)
      .find((key) => /\.jpg$/i.test(key) && !key.endsWith('thumbnail.jpg'));
    if (!captured) {
      // Nothing left to rename — either there never was a frame capture, or a
      // previous (duplicate) invocation already renamed it. Check whether the
      // canonical thumbnail already exists so this method is idempotent.
      return this.existsFile(videoId, 'thumbnail.jpg');
    }
    const target = `${prefix}thumbnail.jpg`;
    await this.s3.send(new CopyObjectCommand({
      Bucket: this.cfg.bucketName,
      CopySource: `${this.cfg.bucketName}/${captured}`,
      Key: target,
      ContentType: 'image/jpeg',
      MetadataDirective: 'REPLACE',
    }));
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.cfg.bucketName, Key: captured }));
    return true;
  }

  private async head(key: string): Promise<boolean> {
    try {
      await this.s3.send(new HeadObjectCommand({ Bucket: this.cfg.bucketName, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}

const DELETE_OBJECTS_LIMIT = 1000;

/**
 * Minimal S3 client surface needed for `deleteByPrefix`, so the pagination
 * and chunked-delete logic can be unit tested without AWS or `S3Client`.
 */
export type DeletePrefixS3Client = {
  send(command: ListObjectsV2Command): Promise<{ Contents?: { Key?: string }[]; IsTruncated?: boolean; NextContinuationToken?: string }>;
  send(command: DeleteObjectsCommand): Promise<unknown>;
};

/** Splits an array into chunks of at most `size` items each. */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

/** Lists every key under `prefix` by following `ListObjectsV2` pagination. */
export async function listAllKeys(s3: DeletePrefixS3Client, bucket: string, prefix: string): Promise<string[]> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const listed = await s3.send(new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
    }));
    for (const obj of listed.Contents ?? []) {
      if (obj.Key) {
        keys.push(obj.Key);
      }
    }
    continuationToken = listed.IsTruncated ? listed.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

/**
 * Deletes every object under `prefix`, paginating `ListObjectsV2` and
 * splitting `DeleteObjects` calls into chunks of at most
 * `DELETE_OBJECTS_LIMIT` keys each (the S3 API limit per call).
 */
export async function deleteByPrefix(s3: DeletePrefixS3Client, bucket: string, prefix: string): Promise<void> {
  const keys = await listAllKeys(s3, bucket, prefix);
  if (keys.length === 0) {
    return;
  }
  for (const chunk of chunkArray(keys, DELETE_OBJECTS_LIMIT)) {
    await s3.send(new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: { Objects: chunk.map((Key) => ({ Key })) },
    }));
  }
}
