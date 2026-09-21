import { describe, it, expect, vi, afterEach } from 'vitest';
import { ECSClient, RunTaskCommand, StopTaskCommand } from '@aws-sdk/client-ecs';
import { EcsFfmpegConverter } from './EcsFfmpegConverter';

const VIDEO_ID = 'd'.repeat(64);

function makeConverter(): EcsFfmpegConverter {
  return new EcsFfmpegConverter({
    awsRegion: 'us-east-1',
    clusterArn: 'arn:aws:ecs:us-east-1:123:cluster/test-cluster',
    taskDefinitionArn: 'arn:aws:ecs:us-east-1:123:task-definition/test-task:1',
    subnetIds: ['subnet-1', 'subnet-2'],
    securityGroupIds: ['sg-1'],
    containerName: 'converter',
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('EcsFfmpegConverter.startConversion', () => {
  it('runs a Fargate task with cluster/taskDefinition/network/VIDEO_ID override', async () => {
    const send = vi.spyOn(ECSClient.prototype, 'send').mockImplementation(async (command: any) => {
      if (command instanceof RunTaskCommand) {
        return { tasks: [{ taskArn: 'arn:aws:ecs:us-east-1:123:task/test-cluster/abc' }] } as any;
      }
      throw new Error(`unexpected command: ${command.constructor.name}`);
    });

    const result = await makeConverter().startConversion(VIDEO_ID);

    expect(result.jobId).toBe('arn:aws:ecs:us-east-1:123:task/test-cluster/abc');
    const call = send.mock.calls.find(([cmd]) => cmd instanceof RunTaskCommand);
    const input = (call![0] as RunTaskCommand).input;
    expect(input.cluster).toBe('arn:aws:ecs:us-east-1:123:cluster/test-cluster');
    expect(input.taskDefinition).toBe('arn:aws:ecs:us-east-1:123:task-definition/test-task:1');
    expect(input.launchType).toBe('FARGATE');
    expect(input.count).toBe(1);
    expect(input.networkConfiguration?.awsvpcConfiguration).toEqual({
      subnets: ['subnet-1', 'subnet-2'],
      securityGroups: ['sg-1'],
      assignPublicIp: 'ENABLED',
    });
    expect(input.overrides?.containerOverrides).toEqual([{
      name: 'converter',
      environment: [{ name: 'VIDEO_ID', value: VIDEO_ID }],
    }]);
  });

  it('throws with the failure reason when RunTask returns no task', async () => {
    vi.spyOn(ECSClient.prototype, 'send').mockImplementation(async () => {
      return { tasks: [], failures: [{ reason: 'RESOURCE:FARGATE' }] } as any;
    });

    await expect(makeConverter().startConversion(VIDEO_ID)).rejects.toThrow(/RESOURCE:FARGATE/);
  });
});

describe('EcsFfmpegConverter.cancelJob', () => {
  it('stops the task', async () => {
    const send = vi.spyOn(ECSClient.prototype, 'send').mockImplementation(async (command: any) => {
      if (command instanceof StopTaskCommand) {
        return {} as any;
      }
      throw new Error(`unexpected command: ${command.constructor.name}`);
    });

    await makeConverter().cancelJob('arn:aws:ecs:us-east-1:123:task/test-cluster/abc');

    const call = send.mock.calls.find(([cmd]) => cmd instanceof StopTaskCommand);
    expect((call![0] as StopTaskCommand).input).toEqual({
      cluster: 'arn:aws:ecs:us-east-1:123:cluster/test-cluster',
      task: 'arn:aws:ecs:us-east-1:123:task/test-cluster/abc',
    });
  });

  it('swallows InvalidParameterException for an already-gone task', async () => {
    vi.spyOn(ECSClient.prototype, 'send').mockImplementation(async () => {
      const error = new Error('The referenced task was not found');
      error.name = 'InvalidParameterException';
      throw error;
    });

    await expect(makeConverter().cancelJob('gone-task-arn')).resolves.toBeUndefined();
  });

  it('rethrows other errors', async () => {
    vi.spyOn(ECSClient.prototype, 'send').mockImplementation(async () => {
      throw new Error('boom');
    });

    await expect(makeConverter().cancelJob('some-task-arn')).rejects.toThrow('boom');
  });
});
