import {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { VideoStorage } from './VideoStorage';
import { database } from '../database';

const fsUnlink = promisify(fs.unlink);
const fsMkdir = promisify(fs.mkdir);
const fsRmdir = promisify(fs.rmdir);

export class VideoStorageS3 implements VideoStorage {
  private s3Client: S3Client;
  private bucketName: string;
  private tempDir: string;

  constructor(bucketName: string, region: string) {
    this.bucketName = bucketName;
    const awsRegion = region;
    this.s3Client = new S3Client({
      region: awsRegion,
    });
    // Temporary directory for video processing
    this.tempDir = path.join(__dirname, '../../.tmp');
  }

  async create(videoId: string, sourcePath: string): Promise<void> {
    // Start conversion in background
    setImmediate(() => this.performConversion(videoId, sourcePath));
  }

  async exists(videoId: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: `${videoId}/index.m3u8`,
      }));
      return true;
    } catch (error) {
      return false;
    }
  }

  async delete(videoId: string): Promise<boolean> {
    try {
      // List all objects with the video prefix
      const listCommand = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Prefix: `${videoId}/`,
      });
      
      const listResponse = await this.s3Client.send(listCommand);
      
      if (!listResponse.Contents || listResponse.Contents.length === 0) {
        return true; // Already deleted or doesn't exist
      }
      
      // Delete all objects
      const deleteCommand = new DeleteObjectsCommand({
        Bucket: this.bucketName,
        Delete: {
          Objects: listResponse.Contents.map(obj => ({ Key: obj.Key })),
        },
      });
      
      await this.s3Client.send(deleteCommand);
      return true;
    } catch (error) {
      console.error('Error deleting video from S3:', error);
      return false;
    }
  }

  async list(): Promise<string[]> {
    try {
      const command = new ListObjectsV2Command({
        Bucket: this.bucketName,
        Delimiter: '/',
      });
      
      const response = await this.s3Client.send(command);
      
      if (!response.CommonPrefixes) {
        return [];
      }
      
      return response.CommonPrefixes
        .map(prefix => prefix.Prefix?.replace('/', '') || '')
        .filter(id => id.length > 0);
    } catch (error) {
      console.error('Error listing videos from S3:', error);
      return [];
    }
  }

  async getFile(videoId: string, filename: string): Promise<{ stream: Readable; mime: string }> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: `${videoId}/${filename}`,
      });
      
      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        throw new Error(`File not found: ${filename}`);
      }
      
      // response.Body is already a Readable stream
      const stream = response.Body as Readable;
      const mime = this.getMimeType(filename);
      
      return { stream, mime };
    } catch (error) {
      throw new Error(`File not found: ${filename}`);
    }
  }

  async existsFile(videoId: string, filename: string): Promise<boolean> {
    try {
      await this.s3Client.send(new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: `${videoId}/${filename}`,
      }));
      return true;
    } catch (error) {
      return false;
    }
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

  private async performConversion(videoId: string, sourcePath: string): Promise<void> {
    // Create temporary directory for processing
    const tempVideoDir = path.join(this.tempDir, videoId);
    await fsMkdir(tempVideoDir, { recursive: true });
    
    const outputPath = path.join(tempVideoDir, 'index.m3u8');
    
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
        try {
          // Generate thumbnail
          await this.generateThumbnail(sourcePath, tempVideoDir);
          console.log(`Thumbnail generated for video ${videoId}`);
        } catch (error) {
          console.error('Failed to generate thumbnail:', error);
        }
        
        // Upload all files to S3
        try {
          await this.uploadDirectoryToS3(tempVideoDir, videoId);
          console.log(`Video files uploaded to S3 for ${videoId}`);
        } catch (error) {
          console.error('Failed to upload to S3:', error);
          await this.updateVideoStatus(videoId, 'failed');
          return;
        }
        
        // Update video status in database
        await this.updateVideoStatus(videoId, 'ready');
        
        // Clean up
        await this.cleanupTempFiles(sourcePath, tempVideoDir);
        
        console.log(`Video conversion completed for ${videoId}`);
      } else {
        const errorMessage = `FFmpeg exited with code ${code}: ${errorOutput}`;
        console.error(errorMessage);
        
        await this.updateVideoStatus(videoId, 'failed');
        await this.cleanupTempFiles(sourcePath, tempVideoDir);
      }
    });
    
    ffmpeg.on('error', async (error) => {
      console.error('FFmpeg error:', error);
      await this.updateVideoStatus(videoId, 'failed');
      await this.cleanupTempFiles(sourcePath, tempVideoDir);
    });
  }

  private async generateThumbnail(sourcePath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const thumbnailPath = path.join(targetDir, 'thumbnail.png');
      
      const ffmpeg = spawn('ffmpeg', [
        '-i', sourcePath,
        '-ss', '10',
        '-vframes', '1',
        '-vf', 'scale=320:180',
        '-y',
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

  private async uploadDirectoryToS3(localDir: string, videoId: string): Promise<void> {
    const files = await promisify(fs.readdir)(localDir);
    
    const uploadPromises = files.map(async (filename) => {
      const filePath = path.join(localDir, filename);
      const fileStream = fs.createReadStream(filePath);
      const key = `${videoId}/${filename}`;
      
      const upload = new Upload({
        client: this.s3Client,
        params: {
          Bucket: this.bucketName,
          Key: key,
          Body: fileStream,
          ContentType: this.getMimeType(filename),
        },
      });
      
      await upload.done();
      console.log(`Uploaded ${key} to S3`);
    });
    
    await Promise.all(uploadPromises);
  }

  private async updateVideoStatus(videoId: string, status: 'ready' | 'failed'): Promise<void> {
    try {
      const videoMetadata = await database.getVideoMetadata(videoId);
      if (videoMetadata) {
        videoMetadata.status = status;
        await database.saveVideoMetadata(videoMetadata);
      }
    } catch (error) {
      console.error('Failed to update video status:', error);
    }
  }

  private async cleanupTempFiles(sourcePath: string, tempDir: string): Promise<void> {
    // Clean up source file
    try {
      await fsUnlink(sourcePath);
    } catch (error) {
      console.error('Failed to delete source file:', error);
    }
    
    // Clean up temporary directory
    try {
      const files = await promisify(fs.readdir)(tempDir);
      for (const file of files) {
        await fsUnlink(path.join(tempDir, file));
      }
      await fsRmdir(tempDir);
    } catch (error) {
      console.error('Failed to clean up temp directory:', error);
    }
  }
}
