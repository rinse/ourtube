export interface Converter {
  startConversion(videoId: string): Promise<ConversionResult>;
  cancelJob(jobId: string): Promise<void>;
}

export type ConversionResult = {
  jobId?: string;
};
