import path from 'path';
import { VideoStorage } from './VideoStorage';
import { VideoStorageFileSystem } from './VideoStorageFileSystem';
import { VideoStorageS3 } from './VideoStorageS3';
import { config } from '../config';

let storageInstance: VideoStorage;

export function getVideoStorage(): VideoStorage {
  if (!storageInstance) {
    const storageType = process.env.VIDEO_STORAGE_TYPE || 'filesystem';
    console.log(`Using video storage type: ${storageType}`);
    switch (storageType) {
      case 's3':
        storageInstance = new VideoStorageS3(
          process.env.S3_BUCKET_NAME ?? 'ourtube-videostorage',
          process.env.AWS_REGION ?? 'ap-northeast-1');
        break;
      case 'filesystem':
        storageInstance = new VideoStorageFileSystem(config.videosDir);
        break;
      default:
        storageInstance = new VideoStorageFileSystem(config.videosDir);
        break;
    }
  }
  return storageInstance;
}

export { VideoStorage } from './VideoStorage';
export { VideoStorageFileSystem } from './VideoStorageFileSystem';
export { VideoStorageS3 } from './VideoStorageS3';
