import { spawn } from 'child_process';
import path from 'path';
import fs from 'fs';

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
    // Probe all streams (no -select_streams) so we can read both the video and
    // audio codecs. Streams are located by codec_type rather than positional
    // index, since stream order is not guaranteed (audio can precede video).
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_name,codec_type,width,height,bit_rate,duration',
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
          const streams: any[] = Array.isArray(probeData.streams) ? probeData.streams : [];
          const videoStream = streams.find((s) => s.codec_type === 'video');
          const audioStream = streams.find((s) => s.codec_type === 'audio');
          if (videoStream) {
            info.videoCodec = videoStream.codec_name;
            if (videoStream.width && videoStream.height) {
              info.resolution = `${videoStream.width}x${videoStream.height}`;
            }
          }
          if (audioStream) {
            info.audioCodec = audioStream.codec_name;
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

/**
 * Decide the ffmpeg `-c:v`/`-c:a` codec arguments for HLS (MPEG-TS) output.
 *
 * Pure function so the (conservative) re-encode-avoidance policy is unit
 * testable without spawning ffmpeg. Stream copy is allowed ONLY when the source
 * codec is known-compatible with MPEG-TS HLS:
 *   - video: `h264` → `-c:v copy`, anything else (or unknown/undefined) → `libx264`
 *   - audio: `aac`  → `-c:a copy`, anything else (or unknown/undefined) → `aac`
 * The undefined/unknown case (e.g. ffprobe failed and returned {}) deliberately
 * falls back to re-encoding, which always works.
 */
export function buildHlsCodecArgs(videoCodec?: string, audioCodec?: string): string[] {
  const v = videoCodec?.toLowerCase();
  const a = audioCodec?.toLowerCase();
  return [
    '-c:v', v === 'h264' ? 'copy' : 'libx264',
    '-c:a', a === 'aac' ? 'copy' : 'aac',
  ];
}

/**
 * Convert a source video to HLS. Resolves on success, rejects on failure.
 *
 * Probes the source first: if the codecs are already MPEG-TS-compatible
 * (H.264 video / AAC audio) the matching stream is copied instead of
 * re-encoded, which is far cheaper. Unknown or incompatible codecs fall back to
 * re-encoding (`libx264` / `aac`). See {@link buildHlsCodecArgs}.
 */
export async function convertVideoToHLS(sourcePath: string, outputPath: string): Promise<void> {
  const info = await probeVideoInfo(sourcePath);
  const codecArgs = buildHlsCodecArgs(info.videoCodec, info.audioCodec);
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', sourcePath,
      ...codecArgs,
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

/**
 * Seek offsets (seconds) tried in order when capturing the thumbnail. `-ss 10`
 * is preferred (skips intros/black frames), but a video shorter than the seek
 * yields no frame, so we fall back to progressively earlier seeks down to the
 * very first frame so short clips still get a thumbnail.
 */
const THUMBNAIL_SEEK_OFFSETS = ['10', '1', '0'];

function captureThumbnailAt(sourcePath: string, thumbnailPath: string, seek: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-i', sourcePath,
      '-ss', seek,
      '-vframes', '1',
      '-vf', 'scale=320:180',
      '-y',
      thumbnailPath,
    ]);

    let errorOutput = '';
    ffmpeg.stderr.on('data', (data) => { errorOutput += data.toString(); });
    ffmpeg.on('close', (code) => {
      // ffmpeg can exit 0 without producing a frame (e.g. -ss past EOF for a
      // video shorter than the seek), so success hinges on a non-empty file
      // actually existing — not on the exit code — otherwise has_thumbnail
      // would lie and the retry would never trigger.
      const produced = code === 0 && fs.existsSync(thumbnailPath) && fs.statSync(thumbnailPath).size > 0;
      resolve(produced);
    });
    ffmpeg.on('error', (error) => {
      reject(new Error(`Failed to spawn ffmpeg for thumbnail: ${error.message}`));
    });
  });
}

/**
 * Sum `#EXTINF` durations from an HLS manifest. Returns `undefined` rather
 * than `0` when the manifest has no segments, so callers can skip storing a
 * misleading duration instead of persisting zero.
 */
export function parseHlsManifestDuration(manifestText: string): number | undefined {
  let total = 0;
  for (const line of manifestText.split('\n')) {
    const match = line.match(/^#EXTINF:(\d+(?:\.\d+)?),/);
    if (match) {
      total += parseFloat(match[1]);
    }
  }
  return total > 0 ? total : undefined;
}

export async function generateThumbnail(sourcePath: string, targetDir: string): Promise<void> {
  const thumbnailPath = path.join(targetDir, THUMBNAIL_FILENAME);
  for (const seek of THUMBNAIL_SEEK_OFFSETS) {
    const produced = await captureThumbnailAt(sourcePath, thumbnailPath, seek);
    if (produced) {
      return;
    }
  }
  throw new Error(
    `Thumbnail generation produced no frame at any seek offset (${THUMBNAIL_SEEK_OFFSETS.join(', ')}s)`,
  );
}
