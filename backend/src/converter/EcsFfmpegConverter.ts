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
