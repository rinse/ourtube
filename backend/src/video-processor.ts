import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { database } from './database';


export function generateVideoId(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(filePath);
    
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}


export async function convertToHLS(
  videoId: string,
  sourcePath: string,
  targetDir: string
): Promise<void> {
  // Create target directory
  fs.mkdirSync(targetDir, { recursive: true });
  
  // Start conversion in background
  setImmediate(() => performConversion(videoId, sourcePath, targetDir));
}

async function performConversion(videoId: string, sourcePath: string, targetDir: string): Promise<void> {
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
        await generateThumbnail(sourcePath, targetDir);
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
      fs.unlinkSync(sourcePath);
      
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

async function generateThumbnail(sourcePath: string, targetDir: string): Promise<void> {
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