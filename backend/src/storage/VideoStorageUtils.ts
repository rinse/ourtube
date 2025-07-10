import { spawn } from 'child_process';
import path from 'path';
import { database } from '../database';

export function getMimeType(filename: string): string {
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

export async function updateVideoStatus(videoId: string, status: 'ready' | 'failed'): Promise<void> {
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

export async function generateThumbnail(sourcePath: string, targetDir: string): Promise<void> {
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

export function convertVideoToHLS(
  sourcePath: string,
  outputPath: string,
  onData: (data: Buffer) => void,
  onClose: (code: number | null, errorOutput: string) => void,
  onError: (error: Error) => void
): void {
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
    onData(data);
  });
  
  ffmpeg.on('close', (code) => {
    onClose(code, errorOutput);
  });
  
  ffmpeg.on('error', onError);
}