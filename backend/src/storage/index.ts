import { VideoStorage } from './VideoStorage';
import { VideoStorageFileSystem } from './VideoStorageFileSystem';

let storageInstance: VideoStorage;

export function getVideoStorage(): VideoStorage {
  if (!storageInstance) {
    storageInstance = new VideoStorageFileSystem();
  }
  return storageInstance;
}

// For testing or custom implementations
export function setVideoStorage(storage: VideoStorage): void {
  storageInstance = storage;
}

export { VideoStorage } from './VideoStorage';
export { VideoStorageFileSystem } from './VideoStorageFileSystem';