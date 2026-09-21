import { AppConfig, ConverterType } from './config';
import { MetadataStore } from './metadata/MetadataStore';
import { DynamoMetadataStore } from './metadata/DynamoMetadataStore';
import { PlaylistStore } from './playlist/PlaylistStore';
import { DynamoPlaylistStore } from './playlist/DynamoPlaylistStore';
import { VideoStorage } from './storage/VideoStorage';
import { S3VideoStorage } from './storage/S3VideoStorage';
import { Converter } from './converter/Converter';
import { LocalFfmpegConverter } from './converter/LocalFfmpegConverter';
import { MediaConvertConverter } from './converter/MediaConvertConverter';
import { EcsFfmpegConverter } from './converter/EcsFfmpegConverter';
import { GenAI, createGenAI } from './genai/GenAI';

export type Dependencies = {
  config: AppConfig;
  metadata: MetadataStore;
  playlist: PlaylistStore;
  storage: VideoStorage;
  converter: Converter;
  genAI: GenAI;
};

export function createDependencies(config: AppConfig): Dependencies {
  const metadata = new DynamoMetadataStore({
    tableName: config.metadata.tableName,
    awsRegion: config.awsRegion,
    endpoint: config.metadata.endpoint,
  });

  const playlist = new DynamoPlaylistStore({
    tableName: config.metadata.tableName,
    awsRegion: config.awsRegion,
    endpoint: config.metadata.endpoint,
  });

  const storage = new S3VideoStorage({
    bucketName: config.storage.bucketName,
    awsRegion: config.awsRegion,
    endpoint: config.storage.endpoint,
    forcePathStyle: config.storage.forcePathStyle,
    uploadsPrefix: config.storage.uploadsPrefix,
    videosPrefix: config.storage.videosPrefix,
    presignTtlSeconds: config.storage.presignTtlSeconds,
  });

  const converter = createConverter(config, { storage, metadata });

  const genAI = createGenAI({ metadata, config });

  return { config, metadata, playlist, storage, converter, genAI };
}

function createConverter(
  config: AppConfig,
  localDeps: { storage: VideoStorage; metadata: MetadataStore },
): Converter {
  switch (config.converter.type) {
    case 'mediaconvert':
      return new MediaConvertConverter({
        awsRegion: config.awsRegion,
        bucketName: config.storage.bucketName,
        uploadsPrefix: config.storage.uploadsPrefix,
        videosPrefix: config.storage.videosPrefix,
        roleArn: requireConfig(config.converter.mediaConvert.roleArn, 'MEDIACONVERT_ROLE_ARN', 'mediaconvert'),
        queueArn: config.converter.mediaConvert.queueArn,
        endpoint: config.converter.mediaConvert.endpoint,
      });
    case 'ecs':
      return new EcsFfmpegConverter({
        awsRegion: config.awsRegion,
        clusterArn: requireConfig(config.converter.ecs.clusterArn, 'ECS_CLUSTER_ARN', 'ecs'),
        taskDefinitionArn: requireConfig(config.converter.ecs.taskDefinitionArn, 'ECS_TASK_DEFINITION_ARN', 'ecs'),
        // RunTask fails outright with an empty subnets/securityGroups list, so
        // catch that here with the same "which env var" error as the ARNs above.
        subnetIds: requireList(config.converter.ecs.subnetIds, 'ECS_SUBNET_IDS', 'ecs'),
        securityGroupIds: requireList(config.converter.ecs.securityGroupIds, 'ECS_SECURITY_GROUP_IDS', 'ecs'),
        containerName: config.converter.ecs.containerName,
      });
    default:
      return new LocalFfmpegConverter(localDeps, config.tmpDir);
  }
}

function requireConfig(value: string | undefined, name: string, mode: ConverterType): string {
  if (!value) {
    throw new Error(`${name} is required when CONVERTER=${mode}`);
  }
  return value;
}

function requireList(value: string[], name: string, mode: ConverterType): string[] {
  if (value.length === 0) {
    throw new Error(`${name} is required when CONVERTER=${mode}`);
  }
  return value;
}
