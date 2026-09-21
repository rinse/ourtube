import {
  ECSClient,
  RunTaskCommand,
  StopTaskCommand,
  type RunTaskCommandInput,
} from '@aws-sdk/client-ecs';
import { Converter, ConversionResult } from './Converter';

export type EcsFfmpegConverterConfig = {
  awsRegion: string;
  clusterArn: string;
  taskDefinitionArn: string;
  subnetIds: string[];
  securityGroupIds: string[];
  containerName: string;
};

/**
 * Runs a Fargate task whose entrypoint (src/task/convert.ts) is
 * LocalFfmpegConverter.run — the same ffmpeg conversion used for local dev,
 * just packaged as a one-shot container. Unlike MediaConvertConverter, there is
 * no completion event to wait for on the success path: the task finalizes its
 * own metadata (status / thumbnail / duration) before exiting. The
 * "ECS Task State Change" EventBridge event handled in src/lambda/conversion.ts
 * is only a safety net for tasks that crash before they get the chance to do
 * that (see src/conversion/ecsTaskEvent.ts).
 *
 * `videoId` is threaded through as the container override's VIDEO_ID env var so
 * the task (and that safety-net event) can map back to the DynamoDB record.
 */
export class EcsFfmpegConverter implements Converter {
  private readonly client: ECSClient;

  constructor(private readonly cfg: EcsFfmpegConverterConfig) {
    this.client = new ECSClient({ region: cfg.awsRegion });
  }

  async startConversion(videoId: string): Promise<ConversionResult> {
    const params: RunTaskCommandInput = {
      cluster: this.cfg.clusterArn,
      taskDefinition: this.cfg.taskDefinitionArn,
      launchType: 'FARGATE',
      count: 1,
      networkConfiguration: {
        awsvpcConfiguration: {
          subnets: this.cfg.subnetIds,
          securityGroups: this.cfg.securityGroupIds,
          // There is no NAT Gateway in this stack (that's the cost this
          // converter exists to avoid), so the task runs in a public subnet
          // and needs its own public IP to reach S3/DynamoDB/ECR.
          assignPublicIp: 'ENABLED',
        },
      },
      overrides: {
        containerOverrides: [{
          name: this.cfg.containerName,
          environment: [{ name: 'VIDEO_ID', value: videoId }],
        }],
      },
    };

    const res = await this.client.send(new RunTaskCommand(params));
    const taskArn = res.tasks?.[0]?.taskArn;
    if (!taskArn) {
      const reason = res.failures?.[0]?.reason;
      throw new Error(`ECS RunTask did not return a task${reason ? `: ${reason}` : ''}`);
    }
    console.log(`[${videoId}] ECS conversion task started: ${taskArn}`);
    return { jobId: taskArn };
  }

  async cancelJob(jobId: string): Promise<void> {
    try {
      await this.client.send(new StopTaskCommand({ cluster: this.cfg.clusterArn, task: jobId }));
      console.log(`ECS conversion task ${jobId} stopped`);
    } catch (error: unknown) {
      if (error instanceof Error && error.name === 'InvalidParameterException') {
        console.log(`ECS conversion task ${jobId} not found (already stopped or expired)`);
        return;
      }
      throw error;
    }
  }
}
