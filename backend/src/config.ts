import path from 'path';
import fs from 'fs';

const getWorkDir = (): string => {
  const workDir = process.env.WORK_DIR || path.join(__dirname, '..', '.workdir');
  console.log("Using work directory:", workDir);
  if (!fs.existsSync(workDir)) {
    fs.mkdirSync(workDir, { recursive: true });
  }
  return workDir;
};

export const config = {
  workDir: getWorkDir(),
  
  get uploadsDir(): string {
    const dir = path.join(this.workDir, 'uploads');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  },
  
  get videosDir(): string {
    return path.join(this.workDir, 'videos');
  },
  
  get conversionDir(): string {
    const dir = path.join(this.workDir, 'conversion');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  },
  
  get databasePath(): string {
    const dbFilename = process.env.DB_FILENAME ?? 'videos.db';
    const dbFilePath = path.join(this.workDir, dbFilename);
    console.log("Using database file path:", dbFilePath);
    return dbFilePath;
  },
  
  get openaiApiKey(): string | undefined {
    return process.env.OPENAI_API_KEY;
  }
};

console.log(`Using work directory: ${config.workDir}`);
