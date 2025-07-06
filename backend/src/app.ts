import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { database, VideoMetadata } from './database';
import { generateVideoId, convertToHLS, getConversionStatus, getAllConversionJobs } from './video-processor';
import {
  ApiErrorResponse,
  ApiStatusResponse,
  VideoListResponse,
  VideoInfoResponse,
  UploadResponse,
  ConversionStatus,
  AllConversionStatusResponse,
  UpdateVideoResponse,
  DeleteVideoResponse,
  VideoItem
} from './api-schemas';

const app = express();
const PORT = process.env.PORT || 4000;

// Configure multer for video uploads
const upload = multer({
  dest: path.join(__dirname, '..', 'uploads'),
  limits: {
    fileSize: 5 * 1024 * 1024 * 1024 // 5GB max file size
  },
  fileFilter: (req, file, cb) => {
    // Accept video files only
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only video files are allowed'));
    }
  }
});

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.get('/api', (req: Request, res: Response) => {
  const response: ApiStatusResponse = {
    message: 'Welcome to Video Streaming Service API',
    status: 'running',
    timestamp: new Date().toISOString()
  };
  res.json(response);
});

app.get('/api/health', (req: Request, res: Response) => {
  const response: ApiStatusResponse = {
    status: 'healthy',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  };
  res.json(response);
});



// Get list of all videos
app.get('/api/videos', async (req: Request, res: Response): Promise<void> => {
  try {
    const videos = await database.listVideos();
    const videoList: VideoItem[] = videos.map(video => {
      // Check if thumbnail exists
      const thumbnailPath = path.join(__dirname, '..', 'videos', video.folder, 'thumbnail.png');
      const hasThumbnail = fs.existsSync(thumbnailPath);
      
      return {
        id: video.id,
        title: video.title,
        hlsUrl: `/api/videos/${video.id}`,
        status: video.status,
        hasThumbnail: hasThumbnail,
        thumbnailUrl: hasThumbnail ? `/api/videos/${video.id}/thumbnail.png` : null
      };
    });
    
    const response: VideoListResponse = {
      videos: videoList,
      count: videoList.length
    };
    res.json(response);
  } catch (error) {
    console.error('Error fetching videos:', error);
    const errorResponse: ApiErrorResponse = {
      error: 'Database error',
      message: 'Failed to fetch videos'
    };
    res.status(500).json(errorResponse);
  }
});

// Serve HLS manifest files (.m3u8)
app.get('/api/videos/:videoid', async (req: Request, res: Response): Promise<void> => {
  const { videoid } = req.params;
  
  try {
    const video = await database.getVideoMetadata(videoid);
    
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: `Video with ID ${videoid} does not exist`
      });
      return;
    }

    if (video.status !== 'ready') {
      res.status(503).json({
        error: 'Video not ready',
        message: `Video is still ${video.status}`,
        status: video.status
      });
      return;
    }

    const manifestPath = path.join(__dirname, '..', 'videos', video.folder, 'index.m3u8');
  
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
  } catch (error) {
    console.error('Error serving manifest:', error);
    res.status(500).json({
      error: 'Database error',
      message: 'Failed to fetch video information'
    });
  }
});

// Get video metadata
app.get('/api/videos/:videoid/info', async (req: Request, res: Response): Promise<void> => {
  const { videoid } = req.params;
  
  try {
    const video = await database.getVideoMetadata(videoid);
    
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: `Video with ID ${videoid} does not exist`
      });
      return;
    }

    // Check if thumbnail exists
    const thumbnailPath = path.join(__dirname, '..', 'videos', video.folder, 'thumbnail.png');
    const hasThumbnail = fs.existsSync(thumbnailPath);

    res.json({
      id: video.id,
      title: video.title,
      hlsUrl: `/api/videos/${video.id}`,
      status: video.status,
      hasThumbnail: hasThumbnail,
      thumbnailUrl: hasThumbnail ? `/api/videos/${video.id}/thumbnail.png` : null
    });
  } catch (error) {
    console.error('Error fetching video info:', error);
    res.status(500).json({
      error: 'Database error',
      message: 'Failed to fetch video information'
    });
  }
});

// Serve HLS segment files (.ts)
app.get('/api/videos/:videoid/:filename', async (req: Request, res: Response): Promise<void> => {
  const { videoid, filename } = req.params;
  
  try {
    const video = await database.getVideoMetadata(videoid);
    
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: `Video with ID ${videoid} does not exist`
      });
      return;
    }

  // Validate file extension for security
  if (!filename.endsWith('.ts') && !filename.endsWith('.vtt') && !filename.endsWith('.m3u8') && filename !== 'thumbnail.png') {
    res.status(400).json({
      error: 'Invalid file type',
      message: 'Only .ts, .vtt, .m3u8 files and thumbnail.png are allowed'
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
  } else if (filename === 'thumbnail.png') {
    res.setHeader('Content-Type', 'image/png');
  }
  
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.sendFile(filePath);
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({
      error: 'Database error',
      message: 'Failed to fetch video information'
    });
  }
});

// Upload video endpoint
app.post('/api/upload', upload.single('video'), async (req: Request, res: Response): Promise<void> => {
  try {
    if (!req.file) {
      res.status(400).json({
        error: 'No file uploaded',
        message: 'Please provide a video file'
      });
      return;
    }

    const title = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');
    
    // Generate video ID from file content
    const videoId = await generateVideoId(req.file.path);
    
    // Check if video already exists
    const existingVideo = await database.getVideoMetadata(videoId);
    if (existingVideo) {
      // Delete uploaded file
      fs.unlinkSync(req.file.path);
      
      res.status(409).json({
        error: 'Video already exists',
        message: `This video has already been uploaded with the title: "${existingVideo.title}"`,
        videoId: videoId,
        existingTitle: existingVideo.title
      });
      return;
    }
    
    // Create video directory
    const videoDir = path.join(__dirname, '..', 'videos', videoId);
    
    // Save video metadata
    const metadata: VideoMetadata = {
      id: videoId,
      title: title,
      folder: videoId,
      status: 'converting',
      created_at: new Date().toISOString()
    };
    
    await database.saveVideoMetadata(metadata);
    
    // Start HLS conversion in background
    convertToHLS(videoId, req.file.path, videoDir);
    
    res.json({
      message: 'Video uploaded successfully',
      videoId: videoId,
      title: title,
      status: 'converting'
    });
  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      error: 'Upload failed',
      message: error instanceof Error ? error.message : 'Failed to process upload'
    });
  }
});

// Get conversion status endpoint
app.get('/api/conversion-status/:videoid', (req: Request, res: Response) => {
  const { videoid } = req.params;
  const status = getConversionStatus(videoid);
  
  if (!status) {
    res.status(404).json({
      error: 'Not found',
      message: 'No conversion job found for this video ID'
    });
    return;
  }
  
  res.json(status);
});

// Get all conversion jobs
app.get('/api/conversion-status', (req: Request, res: Response) => {
  const jobs = getAllConversionJobs();
  res.json({ jobs });
});

// Delete video endpoint
app.delete('/api/videos/:videoid', async (req: Request, res: Response): Promise<void> => {
  const { videoid } = req.params;
  
  try {
    // Check if video exists
    const video = await database.getVideoMetadata(videoid);
    if (!video) {
      res.status(404).json({
        message: 'failure',
        reason: 'Video not found'
      });
      return;
    }

    // Delete from database
    const dbDeleted = await database.deleteVideo(videoid);
    if (!dbDeleted) {
      res.status(500).json({
        message: 'failure',
        reason: 'Failed to delete video from database'
      });
      return;
    }

    // Delete video files
    const videoDir = path.join(__dirname, '..', 'videos', video.folder);
    if (fs.existsSync(videoDir)) {
      fs.rmSync(videoDir, { recursive: true, force: true });
    }

    res.json({ message: 'ok' });
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      message: 'failure',
      reason: error instanceof Error ? error.message : 'Failed to delete video'
    });
  }
});

// Update video title endpoint
app.put('/api/videos/:videoid', async (req: Request, res: Response): Promise<void> => {
  const { videoid } = req.params;
  const { title } = req.body;
  
  try {
    // Validate input
    if (!title || typeof title !== 'string') {
      res.status(400).json({
        message: 'failure',
        reason: 'Title is required and must be a string'
      });
      return;
    }

    // Check if video exists
    const video = await database.getVideoMetadata(videoid);
    if (!video) {
      res.status(404).json({
        message: 'failure',
        reason: 'Video not found'
      });
      return;
    }

    // Update title
    const updated = await database.updateVideoTitle(videoid, title);
    if (!updated) {
      res.status(500).json({
        message: 'failure',
        reason: 'Failed to update video title'
      });
      return;
    }

    res.json({ message: 'ok' });
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      message: 'failure',
      reason: error instanceof Error ? error.message : 'Failed to update video title'
    });
  }
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