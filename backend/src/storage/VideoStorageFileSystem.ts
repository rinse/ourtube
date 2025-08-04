import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { Readable } from 'stream';
import { VideoStorage } from './VideoStorage';
import { getMimeType, updateVideoStatus, updateVideoThumbnailStatus, generateThumbnail, convertVideoToHLS, probeVideoInfo } from './VideoStorageUtils';

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
    
    console.log(`[VideoID: ${videoId}] Starting video conversion`);
    console.log(`[VideoID: ${videoId}] Source: ${sourcePath}`);
    console.log(`[VideoID: ${videoId}] Target directory: ${targetDir}`);
    
    // Log file info
    try {
      const stats = await promisify(fs.stat)(sourcePath);
      console.log(`[VideoID: ${videoId}] File size: ${(stats.size / (1024 * 1024)).toFixed(2)} MB`);
    } catch (error) {
      console.error(`[VideoID: ${videoId}] Failed to get file stats:`, error);
    }
    
    // Probe video properties
    try {
      console.log(`[VideoID: ${videoId}] Probing video properties...`);
      const videoInfo = await probeVideoInfo(sourcePath);
      
      if (Object.keys(videoInfo).length > 0) {
        console.log(`[VideoID: ${videoId}] Video properties:`);
        if (videoInfo.format) console.log(`  Format: ${videoInfo.format}`);
        if (videoInfo.videoCodec) console.log(`  Video codec: ${videoInfo.videoCodec}`);
        if (videoInfo.resolution) console.log(`  Resolution: ${videoInfo.resolution}`);
        if (videoInfo.duration) console.log(`  Duration: ${videoInfo.duration}`);
        if (videoInfo.bitrate) console.log(`  Bitrate: ${videoInfo.bitrate}`);
        
        // Warn about potential issues
        if (videoInfo.videoCodec && !['h264', 'h265', 'hevc', 'vp9', 'vp8'].includes(videoInfo.videoCodec)) {
          console.warn(`[VideoID: ${videoId}] WARNING: Unusual video codec '${videoInfo.videoCodec}' may cause conversion issues`);
        }
        
        if (videoInfo.resolution) {
          const [width, height] = videoInfo.resolution.split('x').map(Number);
          if (width > 3840 || height > 2160) {
            console.warn(`[VideoID: ${videoId}] WARNING: High resolution ${videoInfo.resolution} may require significant processing time`);
          }
        }
      } else {
        console.warn(`[VideoID: ${videoId}] Unable to probe video properties - continuing with conversion`);
      }
    } catch (error) {
      console.error(`[VideoID: ${videoId}] Error probing video properties:`, error);
      // Continue with conversion even if probing fails
    }
    
    convertVideoToHLS(
      sourcePath,
      outputPath,
      (data) => {
        // Only log significant FFmpeg output, not every line
        const dataStr = data.toString();
        if (dataStr.includes('error') || dataStr.includes('warning')) {
          console.log(`[VideoID: ${videoId}] FFmpeg: ${dataStr.trim()}`);
        }
      },
      async (code, errorOutput) => {
        if (code === 0) {
          console.log(`[VideoID: ${videoId}] HLS conversion successful`);
          
          // Generate thumbnail after successful HLS conversion
          let thumbnailGenerated = false;
          try {
            await generateThumbnail(sourcePath, targetDir);
            thumbnailGenerated = true;
            console.log(`[VideoID: ${videoId}] Thumbnail generated successfully`);
          } catch (error) {
            console.error(`[VideoID: ${videoId}] Thumbnail generation failed:`, error);
            // Continue even if thumbnail generation fails
          }
          
          // Update thumbnail status in database
          try {
            await updateVideoThumbnailStatus(videoId, thumbnailGenerated);
          } catch (error) {
            console.error(`[VideoID: ${videoId}] Failed to update thumbnail status in database:`, error);
          }
          
          // Update video status in database
          try {
            await updateVideoStatus(videoId, 'ready');
            console.log(`[VideoID: ${videoId}] Video status updated to 'ready' in database`);
          } catch (error) {
            console.error(`[VideoID: ${videoId}] Failed to update video status to 'ready':`, error);
          }
          
          // Clean up source file
          try {
            await fsUnlink(sourcePath);
            console.log(`[VideoID: ${videoId}] Source file cleaned up`);
          } catch (error) {
            console.error(`[VideoID: ${videoId}] Failed to delete source file:`, error);
          }
          
          console.log(`[VideoID: ${videoId}] Video processing completed successfully`);
        } else {
          console.error(`[VideoID: ${videoId}] CONVERSION FAILED - FFmpeg exit code: ${code}`);
          
          // Extract specific error reason from output
          let failureReason = 'Unknown conversion error';
          if (errorOutput.includes('No such file or directory')) {
            failureReason = 'Input file not found or output directory inaccessible';
          } else if (errorOutput.includes('Invalid data found')) {
            failureReason = 'Invalid or corrupted video file';
          } else if (errorOutput.includes('Unknown encoder')) {
            failureReason = 'Required codec not available (libx264 or aac)';
          } else if (errorOutput.includes('Permission denied')) {
            failureReason = 'Permission denied - cannot read/write files';
          } else if (errorOutput.includes('No space left on device')) {
            failureReason = 'Insufficient disk space';
          } else if (errorOutput.includes('codec not currently supported')) {
            failureReason = 'Video codec not supported for HLS conversion';
          } else if (errorOutput.includes('moov atom not found')) {
            failureReason = 'Incomplete or damaged video file (missing moov atom)';
          }
          
          console.error(`[VideoID: ${videoId}] Failure reason: ${failureReason}`);
          
          // Log a snippet of the error for debugging
          const errorLines = errorOutput.split('\n').filter(line => line.trim());
          const relevantLines = errorLines.slice(-10); // Last 10 lines
          console.error(`[VideoID: ${videoId}] Last error lines:\n${relevantLines.join('\n')}`);
          
          // Update video status to failed in database
          try {
            await updateVideoStatus(videoId, 'failed');
            console.log(`[VideoID: ${videoId}] Video status updated to 'failed' in database`);
          } catch (error) {
            console.error(`[VideoID: ${videoId}] Failed to update video status to 'failed':`, error);
          }
          
          // Clean up source file even on failure
          try {
            await fsUnlink(sourcePath);
            console.log(`[VideoID: ${videoId}] Source file cleaned up after failure`);
          } catch (error) {
            console.error(`[VideoID: ${videoId}] Failed to delete source file after conversion failure:`, error);
          }
        }
      },
      async (error) => {
        console.error(`[VideoID: ${videoId}] CRITICAL ERROR - Failed to start FFmpeg:`, error);
        console.error(`[VideoID: ${videoId}] Error details:`, {
          message: error.message,
          code: (error as any).code,
          syscall: (error as any).syscall
        });
        
        // Update video status to failed in database
        try {
          await updateVideoStatus(videoId, 'failed');
          console.log(`[VideoID: ${videoId}] Video status updated to 'failed' in database`);
        } catch (dbError) {
          console.error(`[VideoID: ${videoId}] Failed to update video status to 'failed':`, dbError);
        }
        
        // Clean up source file
        try {
          await fsUnlink(sourcePath);
          console.log(`[VideoID: ${videoId}] Source file cleaned up after critical error`);
        } catch (cleanupError) {
          console.error(`[VideoID: ${videoId}] Failed to delete source file after critical error:`, cleanupError);
        }
      }
    );
  }
}
