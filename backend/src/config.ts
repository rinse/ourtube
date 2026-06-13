import path from 'path';
import os from 'os';
import fs from 'fs';

export type ConverterType = 'local' | 'mediaconvert';
export type GenAIProvider = 'bedrock' | 'openai' | 'lmstudio';

export type AppConfig = {
  port: number;
  /** Local scratch directory used by the local ffmpeg converter. */
  tmpDir: string;
  awsRegion: string;
  storage: {
    bucketName: string;
    /** Custom S3 endpoint for MinIO in local dev. */
    endpoint?: string;
    /** Path-style addressing (required by MinIO). */
    forcePathStyle: boolean;
    uploadsPrefix: string;
    videosPrefix: string;
    /** TTL for presigned PUT/GET URLs, in seconds. */
    presignTtlSeconds: number;
  };
  metadata: {
    tableName: string;
    /** Custom endpoint for DynamoDB Local. */
    endpoint?: string;
  };
  converter: {
    type: ConverterType;
    mediaConvert: {
      roleArn?: string;
      queueArn?: string;
      /** Account-specific MediaConvert endpoint. */
      endpoint?: string;
    };
  };
  auth: {
    secret: string;
    /** When true, all auth checks are skipped (local dev). */
    bypass: boolean;
    cookieName: string;
    sessionTtlSeconds: number;
    /** Set the Secure flag on the session cookie (disable for local http). */
    cookieSecure: boolean;
  };
  genai: {
    provider: GenAIProvider;
    bedrock: { region: string; modelId: string };
    openai: { apiKey?: string; model: string };
    lmStudio: { host: string; model: string };
  };
};

function bool(value: string | undefined, fallback = false): boolean {
  if (value == null) return fallback;
  return value === '1' || value.toLowerCase() === 'true';
}

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

export function createAppConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const awsRegion = env.AWS_REGION ?? 'ap-northeast-1';
  const tmpDir = env.TMP_DIR ?? path.join(os.tmpdir(), 'videoplayer');
  ensureDir(tmpDir);

  const defaultProvider: GenAIProvider = env.OPENAI_API_KEY ? 'openai' : 'lmstudio';

  return {
    port: parseInt(env.PORT ?? '4000', 10),
    tmpDir,
    awsRegion,
    storage: {
      bucketName: env.S3_BUCKET_NAME ?? 'ourtube-videostorage',
      endpoint: env.S3_ENDPOINT,
      forcePathStyle: bool(env.S3_FORCE_PATH_STYLE, env.S3_ENDPOINT != null),
      uploadsPrefix: env.S3_UPLOADS_PREFIX ?? 'uploads/',
      videosPrefix: env.S3_VIDEOS_PREFIX ?? 'videos/',
      presignTtlSeconds: parseInt(env.PRESIGN_TTL_SECONDS ?? '3600', 10),
    },
    metadata: {
      tableName: env.DYNAMODB_TABLE ?? 'videoplayer',
      endpoint: env.DYNAMODB_ENDPOINT,
    },
    converter: {
      type: (env.CONVERTER as ConverterType) ?? 'local',
      mediaConvert: {
        roleArn: env.MEDIACONVERT_ROLE_ARN,
        queueArn: env.MEDIACONVERT_QUEUE_ARN,
        endpoint: env.MEDIACONVERT_ENDPOINT,
      },
    },
    auth: {
      secret: env.APP_SECRET ?? '',
      bypass: bool(env.AUTH_BYPASS),
      cookieName: env.AUTH_COOKIE_NAME ?? 'vp_session',
      sessionTtlSeconds: parseInt(env.AUTH_SESSION_TTL_SECONDS ?? `${60 * 60 * 24 * 7}`, 10),
      cookieSecure: env.AUTH_COOKIE_SECURE !== 'false',
    },
    genai: {
      provider: (env.GENAI_PROVIDER as GenAIProvider) ?? defaultProvider,
      bedrock: {
        region: env.BEDROCK_REGION ?? awsRegion,
        modelId: env.BEDROCK_MODEL_ID ?? 'apac.anthropic.claude-sonnet-4-20250514-v1:0',
      },
      openai: {
        apiKey: env.OPENAI_API_KEY,
        model: env.OPENAI_MODEL ?? 'gpt-4o',
      },
      lmStudio: {
        host: env.LM_STUDIO_HOST ?? 'http://127.0.0.1:1234/v1',
        model: env.LM_STUDIO_MODEL ?? 'openai/gpt-oss-20b',
      },
    },
  };
}
