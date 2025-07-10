import {
  S3Client,
  HeadObjectCommand,
  ListObjectsV2Command,
  GetObjectCommand,
  DeleteObjectsCommand,
} from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { Readable } from 'stream';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { VideoStorage } from './VideoStorage';
import { getMimeType, updateVideoStatus, generateThumbnail, convertVideoToHLS } from './VideoStorageUtils';

const fsUnlink = promisify(fs.unlink);
const fsMkdir = promisify(fs.mkdir);
const fsRmdir = promisify(fs.rmdir);

export class VideoStorageS3 implements VideoStorage {
  private s3Client: S3Client;
  private bucketName: string;
  private tempDir: string;
  private manifestCache: Map<string, { content: Buffer; mime: string }>;

  constructor(bucketName: string, region: string) {
    this.bucketName = bucketName;
    const awsRegion = region;
    this.s3Client = new S3Client({
      region: awsRegion,
    });
    // Temporary directory for video processing
    this.tempDir = path.join(__dirname, '../../.tmp');
    // Initialize cache for index.m3u8 files
    this.manifestCache = new Map();
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
      // Remove from cache if exists
      const cacheKey = `${videoId}/index.m3u8`;
      if (this.manifestCache.has(cacheKey)) {
        this.manifestCache.delete(cacheKey);
        console.log(`Removed cached index.m3u8 for video ${videoId}`);
      }
      
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
      // Check if this is an index.m3u8 file and if we have it cached
      if (filename === 'index.m3u8') {
        const cacheKey = `${videoId}/index.m3u8`;
        const cached = this.manifestCache.get(cacheKey);
        
        if (cached) {
          console.log(`Serving index.m3u8 from cache for video ${videoId}`);
          const stream = Readable.from(cached.content);
          return { stream, mime: cached.mime };
        }
      }
      
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: `${videoId}/${filename}`,
      });
      
      const response = await this.s3Client.send(command);
      
      if (!response.Body) {
        throw new Error(`File not found: ${filename}`);
      }
      
      // For index.m3u8 files, cache the content
      if (filename === 'index.m3u8') {
        const chunks: Buffer[] = [];
        const stream = response.Body as Readable;
        
        // Collect all chunks
        for await (const chunk of stream) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        
        const content = Buffer.concat(chunks);
        const mime = getMimeType(filename);
        
        // Cache the manifest (typical size is <5KB)
        const cacheKey = `${videoId}/index.m3u8`;
        this.manifestCache.set(cacheKey, { content, mime });
        console.log(`Cached index.m3u8 for video ${videoId} (size: ${content.length} bytes)`);
        
        // Return a new readable stream from the buffer
        return { stream: Readable.from(content), mime };
      }
      
      // For other files, return the stream directly
      const stream = response.Body as Readable;
      const mime = getMimeType(filename);
      
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


  private async performConversion(videoId: string, sourcePath: string): Promise<void> {
    // Create temporary directory for processing
    const tempVideoDir = path.join(this.tempDir, videoId);
    await fsMkdir(tempVideoDir, { recursive: true });
    
    const outputPath = path.join(tempVideoDir, 'index.m3u8');
    
    convertVideoToHLS(
      sourcePath,
      outputPath,
      (data) => {
        console.log(`FFmpeg: ${data}`);
      },
      async (code, errorOutput) => {
        if (code === 0) {
          try {
            // Generate thumbnail
            await generateThumbnail(sourcePath, tempVideoDir);
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
            await updateVideoStatus(videoId, 'failed');
            return;
          }
          
          // Update video status in database
          await updateVideoStatus(videoId, 'ready');
          
          // Clean up
          await this.cleanupTempFiles(sourcePath, tempVideoDir);
          
          console.log(`Video conversion completed for ${videoId}`);
        } else {
          const errorMessage = `FFmpeg exited with code ${code}: ${errorOutput}`;
          console.error(errorMessage);
          
          await updateVideoStatus(videoId, 'failed');
          await this.cleanupTempFiles(sourcePath, tempVideoDir);
        }
      },
      async (error) => {
        console.error('FFmpeg error:', error);
        await updateVideoStatus(videoId, 'failed');
        await this.cleanupTempFiles(sourcePath, tempVideoDir);
      }
    );
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
          ContentType: getMimeType(filename),
        },
      });
      
      await upload.done();
      console.log(`Uploaded ${key} to S3`);
    });
    
    await Promise.all(uploadPromises);
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

  // Cache management methods
  getCacheSize(): number {
    let totalSize = 0;
    for (const [key, value] of this.manifestCache) {
      totalSize += value.content.length;
    }
    return totalSize;
  }

  getCacheInfo(): { count: number; totalSizeBytes: number; videoIds: string[] } {
    const videoIds = new Set<string>();
    let totalSize = 0;
    for (const [key, value] of this.manifestCache) {
      const videoId = key.split('/')[0];
      videoIds.add(videoId);
      totalSize += value.content.length;
    }
    return {
      count: this.manifestCache.size,
      totalSizeBytes: totalSize,
      videoIds: Array.from(videoIds)
    };
  }

  clearCache(): void {
    const previousSize = this.manifestCache.size;
    this.manifestCache.clear();
    console.log(`Cleared manifest cache (${previousSize} entries)`);
  }

  clearCacheForVideo(videoId: string): boolean {
    const cacheKey = `${videoId}/index.m3u8`;
    const deleted = this.manifestCache.delete(cacheKey);
    if (deleted) {
      console.log(`Cleared cache for video ${videoId}`);
    }
    return deleted;
  }
}
