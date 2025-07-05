import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';

const app = express();
const PORT = process.env.PORT || 4000;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api', (req: Request, res: Response) => {
  res.json({
    message: 'Welcome to Video Streaming Service API',
    status: 'running',
    timestamp: new Date().toISOString()
  });
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Video metadata
const videoMetadata = {
  'sample': {
    id: 'sample',
    title: 'サンプル動画',
    folder: 'sample.hls'
  }
};


// Get list of all videos
app.get('/api/videos', (req: Request, res: Response): void => {
  const videos = Object.values(videoMetadata).map(video => ({
    id: video.id,
    title: video.title,
    hlsUrl: `/api/videos/${video.id}`
  }));
  
  res.json({
    videos,
    count: videos.length
  });
});

// Serve HLS manifest files (.m3u8)
app.get('/api/videos/:videoid', (req: Request, res: Response): void => {
  const { videoid } = req.params;
  const video = videoMetadata[videoid as keyof typeof videoMetadata];
  
  if (!video) {
    res.status(404).json({
      error: 'Video not found',
      message: `Video with ID ${videoid} does not exist`
    });
    return;
  }

  const manifestPath = path.join(__dirname, '..', 'videos', video.folder, 'sample.m3u8');
  
  if (!fs.existsSync(manifestPath)) {
    res.status(404).json({
      error: 'Video file not found',
      message: `HLS manifest file for video ${videoid} does not exist`
    });
    return;
  }

  // Read the manifest file and modify segment URLs to include video ID
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  
  // Replace segment filenames with paths that include the video ID
  const modifiedManifest = manifestContent.replace(
    /^([^#\s]+\.(ts|vtt|m3u8))$/gm,
    `${videoid}/$1`
  );
  
  res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  res.setHeader('Cache-Control', 'no-cache');
  res.send(modifiedManifest);
});

// Serve HLS segment files (.ts)
app.get('/api/videos/:videoid/:filename', (req: Request, res: Response): void => {
  const { videoid, filename } = req.params;
  const video = videoMetadata[videoid as keyof typeof videoMetadata];
  
  if (!video) {
    res.status(404).json({
      error: 'Video not found',
      message: `Video with ID ${videoid} does not exist`
    });
    return;
  }

  // Validate file extension for security
  if (!filename.endsWith('.ts') && !filename.endsWith('.vtt') && !filename.endsWith('.m3u8')) {
    res.status(400).json({
      error: 'Invalid file type',
      message: 'Only .ts, .vtt, and .m3u8 files are allowed'
    });
    return;
  }

  const filePath = path.join(__dirname, '..', 'videos', video.folder, filename);
  
  if (!fs.existsSync(filePath)) {
    res.status(404).json({
      error: 'File not found',
      message: `File ${filename} for video ${videoid} does not exist`
    });
    return;
  }

  // Set appropriate content type
  if (filename.endsWith('.ts')) {
    res.setHeader('Content-Type', 'video/mp2t');
  } else if (filename.endsWith('.vtt')) {
    res.setHeader('Content-Type', 'text/vtt');
  } else if (filename.endsWith('.m3u8')) {
    res.setHeader('Content-Type', 'application/vnd.apple.mpegurl');
  }
  
  res.setHeader('Cache-Control', 'public, max-age=3600');
  res.sendFile(filePath);
});

// Get video metadata
app.get('/api/videos/:videoid/info', (req: Request, res: Response): void => {
  const { videoid } = req.params;
  const video = videoMetadata[videoid as keyof typeof videoMetadata];
  
  if (!video) {
    res.status(404).json({
      error: 'Video not found',
      message: `Video with ID ${videoid} does not exist`
    });
    return;
  }

  res.json({
    id: video.id,
    title: video.title,
    hlsUrl: `/api/videos/${video.id}`
  });
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  });
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/api`);
});

export default app;