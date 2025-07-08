import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import { VideoStorage } from './VideoStorage';
import { database } from '../database';

const fsExists = promisify(fs.exists);
const fsReaddir = promisify(fs.readdir);
const fsMkdir = promisify(fs.mkdir);
const fsRm = promisify(fs.rm);
const fsUnlink = promisify(fs.unlink);

export class VideoStorageFileSystem implements VideoStorage {
  private videosBasePath: string;
  
  constructor(videosPath?: string) {
    this.videosBasePath = videosPath || path.join(__dirname, '../../videos');
  }
  
  async create(videoId: string, sourcePath: string): Promise<void> {
    const targetDir = path.join(this.videosBasePath, videoId);
    await fsMkdir(targetDir, { recursive: true });
    
    // Start conversion in background
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
      // If videos directory doesn't exist, return empty array
      return [];
    }
  }
  
  async getFile(videoId: string, filename: string): Promise<{ stream: Readable; mime: string }> {
    const filePath = path.join(this.videosBasePath, videoId, filename);
    
    if (!(await fsExists(filePath))) {
      throw new Error(`File not found: ${filename}`);
    }
    
    const stream = fs.createReadStream(filePath);
    const mime = this.getMimeType(filename);
    
    return { stream, mime };
  }
  
  async existsFile(videoId: string, filename: string): Promise<boolean> {
    const filePath = path.join(this.videosBasePath, videoId, filename);
    return fsExists(filePath);
  }
  
  private getMimeType(filename: string): string {
    const ext = path.extname(filename).toLowerCase();
    const mimeTypes: Record<string, string> = {
      '.m3u8': 'application/vnd.apple.mpegurl',
      '.ts': 'video/mp2t',
      '.vtt': 'text/vtt',
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg'
    };
    
    return mimeTypes[ext] || 'application/octet-stream';
  }
  
  private async performConversion(videoId: string, sourcePath: string, targetDir: string): Promise<void> {
    const outputPath = path.join(targetDir, 'index.m3u8');
    
    const ffmpeg = spawn('ffmpeg', [
      '-i', sourcePath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-hls_time', '10',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'vod',
      '-f', 'hls',
      outputPath
    ]);
    
    let errorOutput = '';
    
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
      console.log(`FFmpeg: ${data}`);
    });
    
    ffmpeg.on('close', async (code) => {
      if (code === 0) {
        // Generate thumbnail after successful HLS conversion
        try {
          await this.generateThumbnail(sourcePath, targetDir);
          console.log(`Thumbnail generated for video ${videoId}`);
        } catch (error) {
          console.error('Failed to generate thumbnail:', error);
          // Continue even if thumbnail generation fails
        }
        
        // Update video status in database
        try {
          const videoMetadata = await database.getVideoMetadata(videoId);
          if (videoMetadata) {
            videoMetadata.status = 'ready';
            await database.saveVideoMetadata(videoMetadata);
          }
        } catch (error) {
          console.error('Failed to update video status:', error);
        }
        
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
        try {
          const videoMetadata = await database.getVideoMetadata(videoId);
          if (videoMetadata) {
            videoMetadata.status = 'failed';
            await database.saveVideoMetadata(videoMetadata);
          }
        } catch (error) {
          console.error('Failed to update video status:', error);
        }
      }
    });
    
    ffmpeg.on('error', async (error) => {
      console.error('FFmpeg error:', error);
      
      // Update video status to failed in database
      try {
        const videoMetadata = await database.getVideoMetadata(videoId);
        if (videoMetadata) {
          videoMetadata.status = 'failed';
          await database.saveVideoMetadata(videoMetadata);
        }
      } catch (error) {
        console.error('Failed to update video status:', error);
      }
    });
  }
  
  private async generateThumbnail(sourcePath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const thumbnailPath = path.join(targetDir, 'thumbnail.png');
      
      // Generate thumbnail from the 10-second mark of the video
      const ffmpeg = spawn('ffmpeg', [
        '-i', sourcePath,
        '-ss', '10',  // Seek to 10 seconds
        '-vframes', '1',  // Extract 1 frame
        '-vf', 'scale=320:180',  // Scale to 320x180 (16:9 aspect ratio)
        '-y',  // Overwrite output file
        thumbnailPath
      ]);
      
      let errorOutput = '';
      
      ffmpeg.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      ffmpeg.on('close', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Thumbnail generation failed with code ${code}: ${errorOutput}`));
        }
      });
      
      ffmpeg.on('error', (error) => {
        reject(error);
      });
    });
  }
}
