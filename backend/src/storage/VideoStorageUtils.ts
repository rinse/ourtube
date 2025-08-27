import { spawn } from 'child_process';
import path from 'path';
import { Database } from '../database';

export interface VideoInfo {
  duration?: string;
  format?: string;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  bitrate?: string;
  fileSize?: number;
}

export async function probeVideoInfo(filePath: string): Promise<VideoInfo> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,bit_rate,duration',
      '-show_entries', 'format=format_name,duration,bit_rate,size',
      '-of', 'json',
      filePath
    ]);
    
    let output = '';
    let errorOutput = '';
    
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });
    
    ffprobe.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    ffprobe.on('close', (code) => {
      const info: VideoInfo = {};
      
      if (code === 0) {
        try {
          const probeData = JSON.parse(output);
          
          // Extract format info
          if (probeData.format) {
            info.format = probeData.format.format_name;
            info.duration = probeData.format.duration ? `${Math.round(parseFloat(probeData.format.duration))}s` : undefined;
            info.bitrate = probeData.format.bit_rate ? `${Math.round(parseInt(probeData.format.bit_rate) / 1000)}kbps` : undefined;
            info.fileSize = probeData.format.size ? parseInt(probeData.format.size) : undefined;
          }
          
          // Extract stream info
          if (probeData.streams && probeData.streams.length > 0) {
            const videoStream = probeData.streams[0];
            info.videoCodec = videoStream.codec_name;
            if (videoStream.width && videoStream.height) {
              info.resolution = `${videoStream.width}x${videoStream.height}`;
            }
          }
          
          console.log('Video probe successful:', info);
        } catch (error) {
          console.error('Failed to parse ffprobe output:', error);
          console.error('Raw output:', output);
        }
      } else {
        console.error(`ffprobe failed with exit code ${code}`);
        if (errorOutput) {
          console.error('ffprobe error:', errorOutput);
        }
      }
      
      resolve(info);
    });
    
    ffprobe.on('error', (error) => {
      console.error('Failed to spawn ffprobe:', error.message);
      resolve({});
    });
  });
}

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

export async function updateVideoStatus(deps: { database: Database }, videoId: string, status: 'ready' | 'failed'): Promise<void> {
  try {
    const videoMetadata = await deps.database.getVideoMetadata(videoId);
    if (videoMetadata) {
      const previousStatus = videoMetadata.status;
      videoMetadata.status = status;
      await deps.database.saveVideoMetadata(videoMetadata);
      console.log(`[VideoID: ${videoId}] Database status updated: ${previousStatus} -> ${status}`);
    } else {
      console.error(`[VideoID: ${videoId}] Cannot update status to '${status}' - video metadata not found in database`);
    }
  } catch (error) {
    console.error(`[VideoID: ${videoId}] Database error while updating status to '${status}':`, error);
    if (error instanceof Error) {
      console.error(`  Error type: ${error.constructor.name}`);
      console.error(`  Error message: ${error.message}`);
      if ('code' in error) {
        console.error(`  Error code: ${(error as any).code}`);
      }
    }
  }
}

export async function updateVideoThumbnailStatus(deps: { database: Database }, videoId: string, hasThumbnail: boolean): Promise<void> {
  try {
    await deps.database.updateVideoThumbnailStatus(videoId, hasThumbnail);
    console.log(`[VideoID: ${videoId}] Database thumbnail status updated: hasThumbnail=${hasThumbnail}`);
  } catch (error) {
    console.error(`[VideoID: ${videoId}] Database error while updating thumbnail status (hasThumbnail=${hasThumbnail}):`, error);
    if (error instanceof Error) {
      console.error(`  Error type: ${error.constructor.name}`);
      console.error(`  Error message: ${error.message}`);
      if ('code' in error) {
        console.error(`  Error code: ${(error as any).code}`);
      }
    }
  }
}

export async function generateThumbnail(sourcePath: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const thumbnailPath = path.join(targetDir, 'thumbnail.png');
    
    console.log(`Generating thumbnail from: ${sourcePath}`);
    console.log(`Thumbnail output path: ${thumbnailPath}`);
    
    const ffmpeg = spawn('ffmpeg', [
      '-i', sourcePath,
      '-ss', '10',     // Seek to 10 seconds
      '-vframes', '1',  // Extract 1 frame
      '-vf', 'scale=320:180',  // Scale to 320x180
      '-y',            // Overwrite output
      thumbnailPath
    ]);
    
    let errorOutput = '';
    
    ffmpeg.stderr.on('data', (data) => {
      errorOutput += data.toString();
    });
    
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        console.log('Thumbnail generated successfully');
        resolve();
      } else {
        console.error(`Thumbnail generation failed with exit code ${code}`);
        
        // Parse specific thumbnail generation errors
        let failureReason = 'Unknown thumbnail generation error';
        if (errorOutput.includes('Output file is empty')) {
          failureReason = 'Failed to extract frame - video might be shorter than 10 seconds';
        } else if (errorOutput.includes('Invalid seek position')) {
          failureReason = 'Cannot seek to 10 seconds - video too short';
        } else if (errorOutput.includes('No such file or directory')) {
          failureReason = 'Source video file not found for thumbnail generation';
        } else if (errorOutput.includes('Permission denied')) {
          failureReason = 'No permission to write thumbnail file';
        } else if (errorOutput.includes('No space left on device')) {
          failureReason = 'Insufficient disk space for thumbnail';
        } else if (errorOutput.includes('could not find codec parameters')) {
          failureReason = 'Cannot decode video - unsupported format or corrupted file';
        }
        
        console.error(`Thumbnail failure reason: ${failureReason}`);
        
        // Log relevant error lines
        const errorLines = errorOutput.split('\n').filter(line => 
          line.trim() && !line.includes('built with') && !line.includes('configuration:')
        );
        if (errorLines.length > 0) {
          console.error('Thumbnail generation error details:');
          errorLines.slice(-5).forEach(line => console.error(`  ${line.trim()}`));
        }
        
        reject(new Error(`Thumbnail generation failed with code ${code}: ${failureReason}`));
      }
    });
    
    ffmpeg.on('error', (error) => {
      console.error(`Failed to spawn FFmpeg for thumbnail: ${error.message}`);
      if (error.message.includes('ENOENT')) {
        console.error('ERROR: FFmpeg not found for thumbnail generation');
      }
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
  console.log(`Starting HLS conversion for: ${sourcePath}`);
  console.log(`Output path: ${outputPath}`);
  
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
  let lastProgressOutput = '';
  
  ffmpeg.stderr.on('data', (data) => {
    const dataStr = data.toString();
    errorOutput += dataStr;
    
    // Capture last few lines for progress tracking
    if (dataStr.includes('frame=') || dataStr.includes('time=')) {
      lastProgressOutput = dataStr;
    }
    
    onData(data);
  });
  
  ffmpeg.on('close', (code) => {
    if (code !== 0) {
      console.error(`FFmpeg conversion failed with exit code ${code}`);
      console.error(`Last progress: ${lastProgressOutput}`);
      
      // Parse common FFmpeg error patterns
      if (errorOutput.includes('No such file or directory')) {
        console.error('ERROR: Input file not found or output directory does not exist');
      } else if (errorOutput.includes('Invalid data found')) {
        console.error('ERROR: Invalid or corrupted input video file');
      } else if (errorOutput.includes('Unknown encoder')) {
        console.error('ERROR: Required video/audio codec not available');
      } else if (errorOutput.includes('Permission denied')) {
        console.error('ERROR: No permission to read input or write output files');
      } else if (errorOutput.includes('No space left on device')) {
        console.error('ERROR: Disk space full');
      } else if (errorOutput.includes('codec not currently supported in container')) {
        console.error('ERROR: Codec incompatibility with HLS container format');
      }
      
      // Log the last 1000 characters of error output for debugging
      const errorSnippet = errorOutput.slice(-1000);
      console.error(`FFmpeg error output (last 1000 chars):\n${errorSnippet}`);
    } else {
      console.log('HLS conversion completed successfully');
    }
    
    onClose(code, errorOutput);
  });
  
  ffmpeg.on('error', (error) => {
    console.error(`Failed to spawn FFmpeg process: ${error.message}`);
    if (error.message.includes('ENOENT')) {
      console.error('ERROR: FFmpeg not found. Please ensure FFmpeg is installed and in PATH');
    }
    onError(error);
  });
}
