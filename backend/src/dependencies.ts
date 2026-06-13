import { AppConfig } from './config';
import { MetadataStore } from './metadata/MetadataStore';
import { DynamoMetadataStore } from './metadata/DynamoMetadataStore';
import { VideoStorage } from './storage/VideoStorage';
import { S3VideoStorage } from './storage/S3VideoStorage';
import { Converter } from './converter/Converter';
import { LocalFfmpegConverter } from './converter/LocalFfmpegConverter';
import { MediaConvertConverter } from './converter/MediaConvertConverter';
import { GenAI, createGenAI } from './genai/GenAI';

export type Dependencies = {
  config: AppConfig;
  metadata: MetadataStore;
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

  const storage = new S3VideoStorage({
    bucketName: config.storage.bucketName,
    awsRegion: config.awsRegion,
    endpoint: config.storage.endpoint,
    forcePathStyle: config.storage.forcePathStyle,
    uploadsPrefix: config.storage.uploadsPrefix,
    videosPrefix: config.storage.videosPrefix,
    presignTtlSeconds: config.storage.presignTtlSeconds,
  });

  const converter: Converter = config.converter.type === 'mediaconvert'
    ? new MediaConvertConverter({
        awsRegion: config.awsRegion,
        bucketName: config.storage.bucketName,
        uploadsPrefix: config.storage.uploadsPrefix,
        videosPrefix: config.storage.videosPrefix,
        roleArn: requireConfig(config.converter.mediaConvert.roleArn, 'MEDIACONVERT_ROLE_ARN'),
        queueArn: config.converter.mediaConvert.queueArn,
        endpoint: config.converter.mediaConvert.endpoint,
      })
    : new LocalFfmpegConverter({ storage, metadata }, config.tmpDir);

  const genAI = createGenAI({ metadata, config });

  return { config, metadata, storage, converter, genAI };
}

function requireConfig(value: string | undefined, name: string): string {
  if (!value) {
    throw new Error(`${name} is required when CONVERTER=mediaconvert`);
  }
  return value;
}
