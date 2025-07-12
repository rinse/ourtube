import path from 'path';
import fs from 'fs';

const getWorkDir = (): string => {
  const workDir = process.env.WORK_DIR || path.join(__dirname, '..', '.workdir');
  
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
    const dir = path.join(this.workDir, 'videos');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  },
  
  get tempDir(): string {
    const dir = path.join(this.workDir, '.tmp');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    return dir;
  },
  
  get databasePath(): string {
    const dbFilename = process.env.DB_FILENAME ?? 'videos.db';
    return path.join(this.workDir, dbFilename);
  }
};

console.log(`Using work directory: ${config.workDir}`);