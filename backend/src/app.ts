import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import { database, VideoMetadata } from './database';
import { generateVideoId } from './video-processor';
import { getVideoStorage } from './storage';
import {
  ApiErrorResponse,
  ApiStatusResponse,
  VideoListResponse,
  VideoInfoResponse,
  UploadResponse,
  UpdateVideoResponse,
  DeleteVideoResponse,
  VideoItem
} from './api-schemas';

const app = express();
const PORT = process.env.PORT || 4000;
const storage = getVideoStorage();

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
    const videoList: VideoItem[] = await Promise.all(videos.map(async video => {
      // Check if thumbnail exists
      const hasThumbnail = await storage.existsFile(video.id, 'thumbnail.png');
      
      return {
        id: video.id,
        title: video.title,
        hlsUrl: `/api/videos/${video.id}/index.m3u8`,
        status: video.status,
        thumbnailUrl: hasThumbnail ? `/api/videos/${video.id}/thumbnail.png` : null
      };
    }));
    
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

// Get video metadata
app.get('/api/videos/:videoid', async (req: Request, res: Response): Promise<void> => {
  const { videoid } = req.params;
  
  try {
    const video = await database.getVideoMetadata(videoid);
    
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: `Video with ID ${videoid} does not exist`
      } satisfies ApiErrorResponse);
      return;
    }

    // Check if thumbnail exists
    const hasThumbnail = await storage.existsFile(video.id, 'thumbnail.png');

    res.json({
      id: video.id,
      title: video.title,
      hlsUrl: `/api/videos/${video.id}/index.m3u8`,
      status: video.status,
      thumbnailUrl: hasThumbnail ? `/api/videos/${video.id}/thumbnail.png` : null
    } satisfies VideoInfoResponse);
  } catch (error) {
    console.error('Error fetching video info:', error);
    res.status(500).json({
      error: 'Database error',
      message: 'Failed to fetch video information'
    });
  }
});

// Serve HLS manifest files (.m3u8)
app.get('/api/videos/:videoid/index.m3u8', async (req: Request, res: Response): Promise<void> => {
  const { videoid } = req.params;
  
  try {
    const video = await database.getVideoMetadata(videoid);
    
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: `Video with ID ${videoid} does not exist`
      } satisfies ApiErrorResponse);
      return;
    }

    if (video.status !== 'ready') {
      res.status(503).json({
        error: 'Video not ready',
        message: `Video is still ${video.status}`
      } satisfies ApiErrorResponse);
      return;
    }

    try {
      const { stream, mime } = await storage.getFile(video.id, 'index.m3u8');
      
      // Read the manifest content
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(chunk);
      }
      const manifestContent = Buffer.concat(chunks).toString('utf8');
      
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-cache');
      res.send(manifestContent);
    } catch (error) {
      res.status(404).json({
        error: 'Video file not found',
        message: `HLS manifest file for video ${videoid} does not exist`
      } satisfies ApiErrorResponse);
      return;
    }
  } catch (error) {
    console.error('Error serving manifest:', error);
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
      } satisfies ApiErrorResponse);
      return;
    }

    // Validate file extension for security
    if (!filename.endsWith('.ts') && !filename.endsWith('.vtt') && !filename.endsWith('.m3u8') && filename !== 'thumbnail.png') {
      res.status(400).json({
        error: 'Invalid file type',
        message: 'Only .ts, .vtt, .m3u8 files and thumbnail.png are allowed'
      } satisfies ApiErrorResponse);
      return;
    }

    try {
      const { stream, mime } = await storage.getFile(video.id, filename);
      
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'public, max-age=3600');
      stream.pipe(res);
    } catch (error) {
      res.status(404).json({
        error: 'File not found',
        message: `File ${filename} for video ${videoid} does not exist`
      } satisfies ApiErrorResponse);
      return;
    }
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
      } satisfies ApiErrorResponse);
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
        message: `This video has already been uploaded with the title: "${existingVideo.title}"`
      } satisfies ApiErrorResponse);
      return;
    }
    
    // Save video metadata
    const metadata: VideoMetadata = {
      id: videoId,
      title: title,
      status: 'converting',
      created_at: new Date().toISOString()
    };
    
    await database.saveVideoMetadata(metadata);
    
    // Start HLS conversion in background
    storage.create(videoId, req.file.path);
    
    res.json({
      message: 'Video uploaded successfully',
      videoId: videoId,
      title: title,
      status: 'converting'
    } satisfies UploadResponse);
  } catch (error) {
    console.error('Upload error:', error);
    
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    
    res.status(500).json({
      error: 'Upload failed',
      message: error instanceof Error ? error.message : 'Failed to process upload'
    } satisfies ApiErrorResponse);
  }
});


// Delete video endpoint
app.delete('/api/videos/:videoid', async (req: Request, res: Response): Promise<void> => {
  const { videoid } = req.params;
  
  try {
    // Check if video exists
    const video = await database.getVideoMetadata(videoid);
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: 'Video not found'
      } satisfies ApiErrorResponse);
      return;
    }

    // Delete from database
    const dbDeleted = await database.deleteVideo(videoid);
    if (!dbDeleted) {
      res.status(500).json({
        error: 'Database error',
        message: 'Failed to delete video from database'
      } satisfies ApiErrorResponse);
      return;
    }

    // Delete video files
    const deleted = await storage.delete(video.id);
    if (!deleted) {
      console.warn(`Failed to delete video directory for ${video.id}`);
    }

    res.json({ message: 'ok' } satisfies DeleteVideoResponse);
  } catch (error) {
    console.error('Delete error:', error);
    res.status(500).json({
      error: 'Delete failed',
      message: error instanceof Error ? error.message : 'Failed to delete video'
    } satisfies ApiErrorResponse);
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
        error: 'Invalid input',
        message: 'Title is required and must be a string'
      } satisfies ApiErrorResponse);
      return;
    }

    // Check if video exists
    const video = await database.getVideoMetadata(videoid);
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: 'Video not found'
      } satisfies ApiErrorResponse);
      return;
    }

    // Update title
    const updated = await database.updateVideoTitle(videoid, title);
    if (!updated) {
      res.status(500).json({
        error: 'Database error',
        message: 'Failed to update video title'
      } satisfies ApiErrorResponse);
      return;
    }

    res.json({ message: 'ok' } satisfies UpdateVideoResponse);
  } catch (error) {
    console.error('Update error:', error);
    res.status(500).json({
      error: 'Update failed',
      message: error instanceof Error ? error.message : 'Failed to update video title'
    } satisfies ApiErrorResponse);
  }
});

app.use((req: Request, res: Response) => {
  res.status(404).json({
    error: 'Not Found',
    message: `Route ${req.method} ${req.path} not found`
  } satisfies ApiErrorResponse);
});

app.use((err: Error, req: Request, res: Response, next: NextFunction) => {
  console.error('Error:', err.stack);
  res.status(500).json({
    error: 'Internal Server Error',
    message: process.env.NODE_ENV === 'development' ? err.message : 'Something went wrong'
  } satisfies ApiErrorResponse);
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  console.log(`API endpoint: http://localhost:${PORT}/api`);
});

export default app;
