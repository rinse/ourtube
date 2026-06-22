import {
  MediaConvertClient,
  CreateJobCommand,
  CancelJobCommand,
  type CreateJobCommandInput,
} from '@aws-sdk/client-mediaconvert';
import { Converter, ConversionResult } from './Converter';

export type MediaConvertConverterConfig = {
  awsRegion: string;
  bucketName: string;
  uploadsPrefix: string;
  videosPrefix: string;
  roleArn: string;
  queueArn?: string;
  endpoint?: string;
};

/**
 * Submits an HLS + thumbnail MediaConvert job. Returns once the job is queued;
 * metadata stays `converting` until the MediaConvert completion event is handled
 * by src/conversion/finalize.ts, which also normalizes output names
 * (master manifest -> index.m3u8, frame capture -> thumbnail.jpg).
 *
 * `videoId` is threaded through UserMetadata so the completion event can map the
 * job back to the DynamoDB record.
 */
export class MediaConvertConverter implements Converter {
  private readonly client: MediaConvertClient;

  constructor(private readonly cfg: MediaConvertConverterConfig) {
    this.client = new MediaConvertClient({
      region: cfg.awsRegion,
      ...(cfg.endpoint ? { endpoint: cfg.endpoint } : {}),
    });
  }

  async startConversion(videoId: string): Promise<ConversionResult> {
    const input = `s3://${this.cfg.bucketName}/${this.cfg.uploadsPrefix}${videoId}`;
    const prefix = `s3://${this.cfg.bucketName}/${this.cfg.videosPrefix}${videoId}/`;
    // Destination basenames decide output filenames: an HLS destination ending
    // in "index" yields a master manifest named index.m3u8 (what the player
    // expects). The frame-capture output lands as thumb.<frame>.jpg and is
    // normalized to thumbnail.jpg in the finalize step.
    const hlsDestination = `${prefix}index`;
    const thumbDestination = `${prefix}thumb`;

    const params: CreateJobCommandInput = {
      Role: this.cfg.roleArn,
      ...(this.cfg.queueArn ? { Queue: this.cfg.queueArn } : {}),
      UserMetadata: { videoId },
      Settings: {
        TimecodeConfig: { Source: 'ZEROBASED' },
        Inputs: [{
          FileInput: input,
          TimecodeSource: 'ZEROBASED',
          VideoSelector: {},
          AudioSelectors: { 'Audio Selector 1': { DefaultSelection: 'DEFAULT' } },
        }],
        OutputGroups: [
          {
            Name: 'HLS',
            OutputGroupSettings: {
              Type: 'HLS_GROUP_SETTINGS',
              HlsGroupSettings: {
                Destination: hlsDestination,
                SegmentLength: 10,
                MinSegmentLength: 0,
                ManifestDurationFormat: 'INTEGER',
              },
            },
            Outputs: [{
              NameModifier: '_hls',
              ContainerSettings: { Container: 'M3U8', M3u8Settings: {} },
              VideoDescription: {
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    RateControlMode: 'QVBR',
                    MaxBitrate: 5_000_000,
                    SceneChangeDetect: 'TRANSITION_DETECTION',
                  },
                },
              },
              AudioDescriptions: [{
                CodecSettings: {
                  Codec: 'AAC',
                  AacSettings: { Bitrate: 96_000, CodingMode: 'CODING_MODE_2_0', SampleRate: 48_000 },
                },
              }],
            }],
          },
          {
            Name: 'Thumbnail',
            OutputGroupSettings: {
              Type: 'FILE_GROUP_SETTINGS',
              FileGroupSettings: { Destination: thumbDestination },
            },
            Outputs: [{
              ContainerSettings: { Container: 'RAW' },
              VideoDescription: {
                Width: 320,
                Height: 180,
                CodecSettings: {
                  Codec: 'FRAME_CAPTURE',
                  FrameCaptureSettings: {
                    FramerateNumerator: 1,
                    FramerateDenominator: 10,
                    MaxCaptures: 1,
                    Quality: 80,
                  },
                },
              },
            }],
          },
        ],
      },
    };

    const res = await this.client.send(new CreateJobCommand(params));
    const jobId = res.Job?.Id;
    console.log(`[${videoId}] MediaConvert job submitted: ${jobId}`);
    return { jobId };
  }

  async cancelJob(jobId: string): Promise<void> {
    try {
      await this.client.send(new CancelJobCommand({ Id: jobId }));
      console.log(`MediaConvert job ${jobId} cancelled`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'NotFoundException') {
        console.log(`MediaConvert job ${jobId} not found (already completed or expired)`);
        return;
      }
      if (error instanceof Error && error.name === 'ConflictException') {
        console.log(`MediaConvert job ${jobId} already in terminal state`);
        return;
      }
      throw error;
    }
  }
}
