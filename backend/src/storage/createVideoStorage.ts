import { Database } from '../database';
import { VideoStorage } from './VideoStorage';
import { VideoStorageFileSystem } from './VideoStorageFileSystem';
import { VideoStorageS3 } from './VideoStorageS3';

export function createVideoStorage(
  database: Database,
  config: { s3BucketName: string, awsRegion: string, videosDir: string, conversionDir: string },
): VideoStorage {
  const storageType = process.env.VIDEO_STORAGE_TYPE || 'filesystem';
  console.log(`Using video storage type: ${storageType}`);
  switch (storageType) {
    case 's3':
      return new VideoStorageS3(database, config);
    case 'filesystem':
      return new VideoStorageFileSystem(database, config.videosDir);
    default:
      return new VideoStorageFileSystem(database, config.videosDir);
  }
}

export { VideoStorage } from './VideoStorage';
export { VideoStorageFileSystem } from './VideoStorageFileSystem';
export { VideoStorageS3 } from './VideoStorageS3';
