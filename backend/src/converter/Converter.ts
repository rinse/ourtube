/**
 * Conversion boundary. `startConversion` is invoked by the conversion entrypoint
 * when a new source upload appears.
 *
 * - LocalFfmpegConverter runs ffmpeg to completion and updates metadata inline.
 * - MediaConvertConverter submits an async job and returns immediately;
 *   metadata is finalized later via the MediaConvert completion event
 *   (see src/conversion/finalize.ts).
 */
export interface Converter {
  startConversion(videoId: string): Promise<ConversionResult>;
  cancelJob(jobId: string): Promise<void>;
}

export type ConversionResult = {
  jobId?: string;
};
