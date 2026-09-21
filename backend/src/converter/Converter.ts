/**
 * Conversion boundary. `startConversion` is invoked by the conversion entrypoint
 * when a new source upload appears.
 *
 * - LocalFfmpegConverter runs ffmpeg to completion and updates metadata inline.
 * - EcsFfmpegConverter runs a Fargate task (LocalFfmpegConverter itself,
 *   packaged as the task's entrypoint — see src/task/convert.ts) that
 *   finalizes metadata inline like the local converter does; the completion
 *   event it fires is only a crash safety net (src/conversion/ecsTaskEvent.ts).
 */
export interface Converter {
  startConversion(videoId: string): Promise<ConversionResult>;
  cancelJob(jobId: string): Promise<void>;
}

export type ConversionResult = {
  jobId?: string;
};
