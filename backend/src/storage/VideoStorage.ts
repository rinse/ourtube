import { Readable } from 'stream';

export interface VideoStorage {
  create(videoId: string, sourcePath: string): Promise<void>;
  exists(videoId: string): Promise<boolean>;
  delete(videoId: string): Promise<boolean>;
  list(): Promise<string[]>;
  getFile(videoId: string, filename: string): Promise<{ stream: Readable; mime: string }>;
  existsFile(videoId: string, filename: string): Promise<boolean>;
}