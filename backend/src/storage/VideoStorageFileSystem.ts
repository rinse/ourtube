import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { Readable } from 'stream';
import { VideoStorage } from './VideoStorage';
import { getMimeType, updateVideoStatus, updateVideoThumbnailStatus, generateThumbnail, convertVideoToHLS } from './VideoStorageUtils';

const fsExists = promisify(fs.exists);
const fsReaddir = promisify(fs.readdir);
const fsMkdir = promisify(fs.mkdir);
const fsRm = promisify(fs.rm);
const fsUnlink = promisify(fs.unlink);

export class VideoStorageFileSystem implements VideoStorage {
  private videosBasePath: string;

  constructor(videosPath: string) {
    this.videosBasePath = videosPath;
    // Ensure the videos directory exists for filesystem storage
    if (!fs.existsSync(this.videosBasePath)) {
      fs.mkdirSync(this.videosBasePath, { recursive: true });
      console.log(`Created videos directory: ${this.videosBasePath}`);
    }
  }

  async create(videoId: string, sourcePath: string): Promise<void> {
    const targetDir = path.join(this.videosBasePath, videoId);
    await fsMkdir(targetDir, { recursive: true });
    setImmediate(() => this.performConversion(videoId, sourcePath, targetDir));
  }

  async exists(videoId: string): Promise<boolean> {
    const dirPath = path.join(this.videosBasePath, videoId);
    return fsExists(dirPath);
  }

  async delete(videoId: string): Promise<boolean> {
    const dirPath = path.join(this.videosBasePath, videoId);
    try {
      await fsRm(dirPath, { recursive: true, force: true });
      return true;
    } catch (error) {
      console.error(`Failed to delete video directory ${videoId}:`, error);
      return false;
    }
  }

  async list(): Promise<string[]> {
    try {
      const entries = await fsReaddir(this.videosBasePath, { withFileTypes: true });
      return entries
        .filter(entry => entry.isDirectory())
        .map(entry => entry.name);
    } catch (error) {
      console.error('Failed to list video directories:', error);
      return [];
    }
  }

  async getFile(videoId: string, filename: string): Promise<{ stream: Readable; mime: string }> {
    const filePath = path.join(this.videosBasePath, videoId, filename);
    if (!(await fsExists(filePath))) {
      throw new Error(`File not found: ${filename}`);
    }
    const stream = fs.createReadStream(filePath);
    const mime = getMimeType(filename);
    return { stream, mime };
  }

  async existsFile(videoId: string, filename: string): Promise<boolean> {
    const filePath = path.join(this.videosBasePath, videoId, filename);
    return fsExists(filePath);
  }

  private async performConversion(videoId: string, sourcePath: string, targetDir: string): Promise<void> {
    const outputPath = path.join(targetDir, 'index.m3u8');
    
    convertVideoToHLS(
      sourcePath,
      outputPath,
      (data) => {
        console.log(`FFmpeg: ${data}`);
      },
      async (code, errorOutput) => {
        if (code === 0) {
          // Generate thumbnail after successful HLS conversion
          let thumbnailGenerated = false;
          try {
            await generateThumbnail(sourcePath, targetDir);
            thumbnailGenerated = true;
            console.log(`Thumbnail generated for video ${videoId}`);
          } catch (error) {
            console.error('Failed to generate thumbnail:', error);
            // Continue even if thumbnail generation fails
          }
          
          // Update thumbnail status in database
          await updateVideoThumbnailStatus(videoId, thumbnailGenerated);
          
          // Update video status in database
          await updateVideoStatus(videoId, 'ready');
          
          // Clean up source file
          try {
            await fsUnlink(sourcePath);
          } catch (error) {
            console.error('Failed to delete source file:', error);
          }
          
          console.log(`Video conversion completed for ${videoId}`);
        } else {
          const errorMessage = `FFmpeg exited with code ${code}: ${errorOutput}`;
          console.error(errorMessage);
          
          // Update video status to failed in database
          await updateVideoStatus(videoId, 'failed');
        }
      },
      async (error) => {
        console.error('FFmpeg error:', error);
        // Update video status to failed in database
        await updateVideoStatus(videoId, 'failed');
      }
    );
  }
}
