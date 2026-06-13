import { spawn } from 'child_process';
import path from 'path';

export interface VideoInfo {
  duration?: string;
  format?: string;
  videoCodec?: string;
  audioCodec?: string;
  resolution?: string;
  bitrate?: string;
  fileSize?: number;
}

export function getMimeType(filename: string): string {
  const ext = path.extname(filename).toLowerCase();
  const mimeTypes: Record<string, string> = {
    '.m3u8': 'application/vnd.apple.mpegurl',
    '.ts': 'video/mp2t',
    '.vtt': 'text/vtt',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
  };
  return mimeTypes[ext] || 'application/octet-stream';
}

export async function probeVideoInfo(filePath: string): Promise<VideoInfo> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=codec_name,width,height,bit_rate,duration',
      '-show_entries', 'format=format_name,duration,bit_rate,size',
      '-of', 'json',
      filePath,
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => { output += data.toString(); });
    ffprobe.on('close', (code) => {
      const info: VideoInfo = {};
      if (code === 0) {
        try {
          const probeData = JSON.parse(output);
          if (probeData.format) {
            info.format = probeData.format.format_name;
            info.duration = probeData.format.duration ? `${Math.round(parseFloat(probeData.format.duration))}s` : undefined;
            info.bitrate = probeData.format.bit_rate ? `${Math.round(parseInt(probeData.format.bit_rate) / 1000)}kbps` : undefined;
            info.fileSize = probeData.format.size ? parseInt(probeData.format.size) : undefined;
          }
          if (probeData.streams && probeData.streams.length > 0) {
            const videoStream = probeData.streams[0];
            info.videoCodec = videoStream.codec_name;
            if (videoStream.width && videoStream.height) {
              info.resolution = `${videoStream.width}x${videoStream.height}`;
            }
          }
        } catch (error) {
          console.error('Failed to parse ffprobe output:', error);
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

/** Convert a source video to HLS. Resolves on success, rejects on failure. */
export function convertVideoToHLS(sourcePath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', sourcePath,
      '-c:v', 'libx264',
      '-c:a', 'aac',
      '-hls_time', '10',
      '-hls_list_size', '0',
      '-hls_playlist_type', 'vod',
      '-f', 'hls',
      outputPath,
    ]);

    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const snippet = errorOutput.split('\n').filter((l) => l.trim()).slice(-10).join('\n');
        reject(new Error(`ffmpeg HLS conversion failed (code ${code}):\n${snippet}`));
      }
    });
    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg: ${error.message}`));
    });
  });
}

/**
 * Capture a single thumbnail frame at ~10s into the video, written as
 * `thumbnail.jpg`. JPEG (not PNG) so the filename is identical to what the
 * MediaConvert frame-capture path produces.
 */
export const THUMBNAIL_FILENAME = 'thumbnail.jpg';

export function generateThumbnail(sourcePath: string, targetDir: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const thumbnailPath = path.join(targetDir, THUMBNAIL_FILENAME);
    const ffmpeg = spawn('ffmpeg', [
      '-i', sourcePath,
      '-ss', '10',
      '-vframes', '1',
      '-vf', 'scale=320:180',
      '-y',
      thumbnailPath,
    ]);

    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });
    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const snippet = errorOutput.split('\n').filter((l) => l.trim()).slice(-5).join('\n');
        reject(new Error(`Thumbnail generation failed (code ${code}):\n${snippet}`));
      }
    });
    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg for thumbnail: ${error.message}`));
    });
  });
}
