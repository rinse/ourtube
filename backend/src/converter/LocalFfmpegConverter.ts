import fs from 'fs';
import path from 'path';
import { promisify } from 'util';
import { Converter } from './Converter';
import { VideoStorage } from '../storage/VideoStorage';
import { MetadataStore } from '../metadata/MetadataStore';
import { convertVideoToHLS, generateThumbnail } from '../media/ffmpeg';

const fsMkdir = promisify(fs.mkdir);
const fsRm = promisify(fs.rm);

/**
 * Local stand-in for MediaConvert: downloads the source, runs ffmpeg to produce
 * HLS + a thumbnail, publishes outputs to storage, and finalizes metadata
 * inline. Used for `docker compose` / fast local dev.
 */
export class LocalFfmpegConverter implements Converter {
  constructor(
    private readonly deps: { storage: VideoStorage; metadata: MetadataStore },
    private readonly tmpDir: string,
  ) {}

  async startConversion(videoId: string): Promise<void> {
    // Kick off the long-running ffmpeg work in the background and resolve
    // immediately, mirroring MediaConvert's "submit and return" semantics so the
    // API route can always await startConversion. Safe here because the local
    // converter only runs inside the long-lived dev server (never a Lambda).
    setImmediate(() => {
      this.process(videoId).catch((error) => {
        console.error(`[${videoId}] background conversion crashed:`, error);
      });
    });
  }

  private async process(videoId: string): Promise<void> {
    const workDir = path.join(this.tmpDir, videoId);
    const sourcePath = path.join(workDir, 'source');
    const outDir = path.join(workDir, 'out');
    try {
      await fsMkdir(outDir, { recursive: true });
      await this.deps.storage.downloadUpload(videoId, sourcePath);

      await convertVideoToHLS(sourcePath, path.join(outDir, 'index.m3u8'));

      let hasThumbnail = false;
      try {
        await generateThumbnail(sourcePath, outDir);
        hasThumbnail = true;
      } catch (error) {
        console.error(`[${videoId}] thumbnail generation failed:`, error);
      }

      await this.deps.storage.uploadVideoDir(videoId, outDir);
      await this.deps.metadata.updateThumbnail(videoId, hasThumbnail);
      await this.deps.metadata.updateStatus(videoId, 'ready');
      console.log(`[${videoId}] local conversion complete (thumbnail=${hasThumbnail})`);
    } catch (error) {
      console.error(`[${videoId}] local conversion failed:`, error);
      await this.deps.metadata.updateStatus(videoId, 'failed');
    } finally {
      await this.cleanup(videoId, workDir);
    }
  }

  private async cleanup(videoId: string, workDir: string): Promise<void> {
    try {
      await this.deps.storage.deleteUpload(videoId);
    } catch (error) {
      console.error(`[${videoId}] failed to delete source upload:`, error);
    }
    try {
      await fsRm(workDir, { recursive: true, force: true });
    } catch (error) {
      console.error(`[${videoId}] failed to clean temp dir:`, error);
    }
  }
}
