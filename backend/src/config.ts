import path from 'path';
import fs from 'fs';

export type AppConfig = {
  port: number,
  // directories
  workDir: string,
  uploadsDir: string,
  videosDir: string,
  conversionDir: string,
  // database file
  databasePath: string,
  // storage
  storageType: string,
  s3BucketName: string,
  awsRegion: string,
  // AI
  openaiApiKey?: string,
  lmStudioHost: string,
}

export async function createAppConfig(): Promise<AppConfig> {
  const port = parseInt(process.env.PORT ?? '4000', 10)
  const workDir = process.env.WORK_DIR || path.join(__dirname, '..', '.workdir');
  const uploadsDir = path.join(workDir, 'uploads');
  const videosDir = path.join(workDir, 'videos');
  const conversionDir = path.join(workDir, 'conversion');
  await Promise.all([
    ensureDirExists(workDir),
    ensureDirExists(uploadsDir),
    ensureDirExists(videosDir),
    ensureDirExists(conversionDir),
  ]);
  const dbFilename = process.env.DB_FILENAME ?? 'videos.db';
  const databasePath = path.join(workDir, dbFilename);
  const storageType = process.env.VIDEO_STORAGE_TYPE ?? 'filesystem';
  const s3BucketName = process.env.S3_BUCKET_NAME ?? 'ourtube-videostorage';
  const awsRegion = process.env.AWS_REGION ?? 'ap-northeast-1';
  const openaiApiKey = process.env.OPENAI_API_KEY;
  const lmStudioHost = process.env.LM_STUDIO_HOST ?? 'http://127.0.0.1:1234/v1';
  return {
    port,
    workDir,
    uploadsDir,
    videosDir,
    conversionDir,
    databasePath,
    storageType,
    s3BucketName,
    awsRegion,
    openaiApiKey,
    lmStudioHost,
  };
}

async function ensureDirExists(pathDir: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    fs.mkdir(pathDir, { recursive: true }, (err, _path) => {
      if (err != null) {
        reject(err);
      } else {
        resolve();
      }
    });
  });
}
