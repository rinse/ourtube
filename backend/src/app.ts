import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
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
  VideoItem,
  SuggestVideoTitleResponse
} from './api-schemas';
import { createGenAI } from './genai/GenAI';
import { multerOptions } from './multer/multer';

dotenv.config({ path: './.env' });

const app = express();
const PORT = process.env.PORT ?? 4000;
const storage = getVideoStorage();
const genAI = createGenAI();

// Configure multer for video uploads
const upload = multer(multerOptions);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Get list of all videos
app.get('/api/videos', async (req: Request, res: Response): Promise<void> => {
  let videos: VideoMetadata[];
  try {
    videos = await database.listVideos();
  } catch (error) {
    console.error('Error fetching videos:', error);
    const errorResponse: ApiErrorResponse = {
      error: 'Database error',
      message: 'Failed to fetch videos'
    };
    res.status(500).json(errorResponse);
    return;
  }
  const videoItems = videos.map(video => {
    return {
      id: video.id,
      title: video.title,
      hlsUrl: `/api/videos/${video.id}/index.m3u8`,
      status: video.status,
      thumbnailUrl: video.has_thumbnail ? `/api/videos/${video.id}/thumbnail.png` : undefined,
    } satisfies VideoItem;
  });
  res.json({
    videos: videoItems,
    count: videoItems.length,
  } satisfies VideoListResponse);
});

// Get video metadata
app.get('/api/videos/:videoId', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  try {
    const video = await database.getVideoMetadata(videoId);
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: `Video with ID ${videoId} does not exist`
      } satisfies ApiErrorResponse);
      return;
    }
    res.json({
      id: video.id,
      title: video.title,
      hlsUrl: `/api/videos/${video.id}/index.m3u8`,
      status: video.status,
      thumbnailUrl: video.has_thumbnail ? `/api/videos/${video.id}/thumbnail.png` : undefined,
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
app.get('/api/videos/:videoId/index.m3u8', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  let video: VideoMetadata;
  try {
    const metadata = await database.getVideoMetadata(videoId);
    if (!metadata) {
      res.status(404).json({
        error: 'Video not found',
        message: `Video with ID ${videoId} does not exist`
      } satisfies ApiErrorResponse);
      return;
    }
    video = metadata;
  } catch (error) {
    console.error('Error serving manifest:', error);
    res.status(500).json({
      error: 'Database error',
      message: 'Failed to fetch video information'
    });
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
      message: `HLS manifest file for video ${videoId} does not exist`
    } satisfies ApiErrorResponse);
    return;
  }
});

// Serve HLS segment files (.ts)
app.get('/api/videos/:videoId/:filename', async (req: Request, res: Response): Promise<void> => {
  const { videoId, filename } = req.params;
  let video: VideoMetadata;
  try {
    const metadata = await database.getVideoMetadata(videoId);
    if (!metadata) {
      res.status(404).json({
        error: 'Video not found',
        message: `Video with ID ${videoId} does not exist`
      } satisfies ApiErrorResponse);
      return;
    }
    video = metadata;
  } catch (error) {
    console.error('Error serving file:', error);
    res.status(500).json({
      error: 'Database error',
      message: 'Failed to fetch video information'
    });
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
      message: `File ${filename} for video ${videoId} does not exist`
    } satisfies ApiErrorResponse);
    return;
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
      created_at: new Date().toISOString(),
      has_thumbnail: false
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
    console.error('Upload processing failed:', error);
    // Log detailed error information
    if (error instanceof Error) {
      console.error('  Error type:', error.constructor.name);
      console.error('  Error message:', error.message);
      if (error.stack) {
        const stackLines = error.stack.split('\n').slice(0, 5);
        console.error('  Stack trace:\n', stackLines.join('\n'));
      }
    }
    // Log request details for debugging
    if (req.file) {
      console.error('  File details:', {
        originalname: req.file.originalname,
        mimetype: req.file.mimetype,
        size: req.file.size,
        path: req.file.path
      });
    }
    // Clean up uploaded file on error
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
        console.log('  Cleaned up uploaded file after error');
      } catch (cleanupError) {
        console.error('  Failed to clean up uploaded file:', cleanupError);
      }
    }
    res.status(500).json({
      error: 'Upload failed',
      message: error instanceof Error ? error.message : 'Failed to process upload'
    } satisfies ApiErrorResponse);
  }
});

// Delete video endpoint
app.delete('/api/videos/:videoId', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
  try {
    // Check if video exists
    const video = await database.getVideoMetadata(videoId);
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: 'Video not found'
      } satisfies ApiErrorResponse);
      return;
    }
    // Delete from database
    const dbDeleted = await database.deleteVideo(videoId);
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
app.put('/api/videos/:videoId', async (req: Request, res: Response): Promise<void> => {
  const { videoId } = req.params;
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
    const video = await database.getVideoMetadata(videoId);
    if (!video) {
      res.status(404).json({
        error: 'Video not found',
        message: 'Video not found'
      } satisfies ApiErrorResponse);
      return;
    }
    // Update title
    const updated = await database.updateVideoTitle(videoId, title);
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

// Suggest video title using ChatGPT
app.post('/api/suggest-video-title', async (req: Request, res: Response): Promise<void> => {
  const { fileName } = req.body;
  try {
    // Validate input
    if (!fileName || typeof fileName !== 'string') {
      res.status(400).json({
        error: 'Invalid input',
        message: 'fileName is required in request body'
      } satisfies ApiErrorResponse);
      return;
    }
    const suggestedTitle = await genAI.suggestVideoTitle(fileName);
    if (!suggestedTitle) {
      res.status(500).json({
        error: 'Generation failed',
        message: 'Failed to generate title suggestion'
      } satisfies ApiErrorResponse);
      return;
    }
    res.json({
      suggestedTitle
    } satisfies SuggestVideoTitleResponse);
  } catch (error) {
    console.error('Title suggestion error:', error);
    res.status(500).json({
      error: 'Title suggestion failed',
      message: error instanceof Error ? error.message : 'Failed to suggest title'
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
