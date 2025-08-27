import express, { Request, Response, NextFunction } from 'express';
import dotenv from 'dotenv';
import fs from 'fs';
import multer from 'multer';
import { createVideoStorage } from './storage/createVideoStorage';
import {
  ApiErrorResponse,
  UploadResponse,
  UpdateVideoResponse,
  DeleteVideoResponse,
  SuggestVideoTitleResponse
} from './api-schemas';
import { createGenAI } from './genai/GenAI';
import { createMulterOptions } from './multer/multer';
import { listVideos } from './api/videos/list';
import { getVideo } from './api/videos/get';
import { getVideoFile, VideoFile, } from './api/videos/video/file';
import { IllegalArgumentError, unlink } from './utils';
import { deleteVideo } from './api/videos/video/delete';
import { updateVideoTitle } from './api/videos/update';
import { uploadVideo } from './api/upload';
import { suggetVideoTitle } from './api/suggest-video-title';
import { createAppConfig } from './config';
import { Database } from './database';

main();

async function main() {
  dotenv.config({ path: './.env' });

  const config = await createAppConfig();
  console.log('AppConfiguration: %o', config);

  const database = new Database(config.databasePath);
  const storage = createVideoStorage(database, config);
  const genAI = createGenAI({ database, config });
  const dependencies = {
    config,
    database,
    genAI,
    storage,
  };

  const app = express();

  // Set up middlewares
  const upload = multer(createMulterOptions(config.uploadsDir));
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Set up routes
  app.get('/api/videos', async (req: Request, res: Response): Promise<void> => {
    try {
      const videos = await listVideos(dependencies);
      res.json(videos);
      return;
    } catch (error) {
      console.error('Error on /api/videos', error);
      res.status(500).json(internalServerError());
      return;
    }
  });

  app.get('/api/videos/:videoId', async (req: Request, res: Response): Promise<void> => {
    const { videoId } = req.params;
    try {
      const video = await getVideo(dependencies, videoId);
      if (video == null) {
        res.status(404).json({
          error: 'Video not found',
          message: `Video with ID ${videoId} does not exist`
        } satisfies ApiErrorResponse);
        return;
      }
      console.log(`Fetched video ${video}`);
      res.status(200).json(video);
      return;
    } catch (error) {
      console.error(`Error on /api/videos/${videoId}`, error);
      res.status(500).json(internalServerError());
      return;
    }
  });

  app.delete('/api/videos/:videoId', async (req: Request, res: Response): Promise<void> => {
    const { videoId } = req.params;
    let isDeleted: boolean;
    try {
      isDeleted = await deleteVideo(dependencies, videoId);
    } catch (error) {
      res.status(500).json(internalServerError());
      return;
    }
    if (!isDeleted) {
      res.status(404).json(videoNotFoundError(videoId));
      return;
    }
    res.json({ message: 'ok' } satisfies DeleteVideoResponse);
    return;
  });

  app.put('/api/videos/:videoId', async (req: Request, res: Response): Promise<void> => {
    const { videoId } = req.params;
    const { title } = req.body;
    if (typeof title !== 'string') {
      res.status(400).json({
        error: 'Invalid input',
        message: 'Title is required and must be a string'
      } satisfies ApiErrorResponse);
      return;
    }
    try {
      const isUpdated = await updateVideoTitle(dependencies, videoId, title);
      if (!isUpdated) {
        res.status(404).json(videoNotFoundError(videoId));
        return;
      }
      res.json({ message: 'ok' } satisfies UpdateVideoResponse);
      return;
    } catch (error) {
      console.error('Update error:', error);
      res.status(500).json(internalServerError());
      return;
    }
  });

  app.get('/api/videos/:videoId/:filename', async (req: Request, res: Response): Promise<void> => {
    const { videoId, filename } = req.params;
    let file: VideoFile | null;
    try {
      file = await getVideoFile(dependencies, videoId, filename);
    } catch (error: unknown) {
      if (error instanceof IllegalArgumentError) {
        res.status(400).json({
          error: 'Invalid file type',
          message: 'Only .ts, .vtt, .m3u8 files, index.m3u8 and thumbnail.png are allowed'
        } satisfies ApiErrorResponse);
        return;
      }
      console.error(`Error on /api/videos/${videoId}/${filename}`, error);
      res.status(500).json(internalServerError());
      return;
    }
    if (file == null) {
      res.status(404).json(videoNotFoundError(videoId));
      return;
    }
    switch (file.status) {
      case 'ready': {
        res.setHeader('Content-Type', file.mime);
        res.setHeader('Cache-Control', 'public, max-age=3600');
        file.stream.pipe(res);
        return;
      }
      case 'converting': {
        res.status(503).json(videoStillConvertingError(videoId));
        return;
      }
      case 'failed': {
        res.status(400).json(videoConversionFailedError(videoId));
        return;
      }
    }
  });

  app.post('/api/upload', upload.single('video'), async (req: Request, res: Response): Promise<void> => {
    if (!req.file) {
      res.status(400).json({
        error: 'No file uploaded',
        message: 'Please provide a video file'
      } satisfies ApiErrorResponse);
      return;
    }
    const title = req.body.title || req.file.originalname.replace(/\.[^/.]+$/, '');
    let response: UploadResponse | null;
    try {
      response = await uploadVideo(dependencies, title, req.file);
    } catch (error) {
      console.error('Upload processing failed:', error);
      if (req.file != null && fs.existsSync(req.file.path)) {
        try {
          unlink(req.file.path);
          console.log('  Cleaned up uploaded file after error');
        } catch (cleanupError) {
          console.error('  Failed to clean up uploaded file:', cleanupError);
        }
      }
      res.status(500).json(internalServerError());
      return;
    }
    if (response == null) {
      res.status(409).json({
        error: 'Video already exists',
        message: `This video has already been uploaded with the title: "${title}"`
      } satisfies ApiErrorResponse);
      return;
    }
    res.status(201)
      .location(`/api/videos/${response.videoId}`)
      .json(response);
    return;
  });

  app.post('/api/suggest-video-title', async (req: Request, res: Response): Promise<void> => {
    const { fileName } = req.body;
    if (!fileName || typeof fileName !== 'string') {
      res.status(400).json({
        error: 'Invalid input',
        message: 'fileName is required in request body'
      } satisfies ApiErrorResponse);
      return;
    }
    let title: string;
    try {
      title = await suggetVideoTitle(dependencies, fileName);
    } catch (error) {
      if (error instanceof IllegalArgumentError) {
        res.status(400).json({
          error: 'Invalid file type',
          message: 'Only .ts, .vtt, .m3u8 files, index.m3u8 and thumbnail.png are allowed'
        } satisfies ApiErrorResponse);
        return;
      }
      console.error(`Error on /api/suggest-video-title`, error);
      res.status(500).json(internalServerError());
      return;
    }
    res.json({
      suggestedTitle: title,
    } satisfies SuggestVideoTitleResponse);
    return;
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

  // Start the server
  const _server = app.listen(config.port, (_error) => {
    console.log(`Server is running on port ${config.port}`);
    console.log(`API endpoint: http://localhost:${config.port}/api`);
  });
}

function videoStillConvertingError(videoId: string): ApiErrorResponse {
  return {
    error: 'Video not ready',
    message: `Video ${videoId} is still converting`
  };
}

function videoConversionFailedError(videoId: string): ApiErrorResponse {
  return {
    error: 'Video not available',
    message: `Video conversion for ${videoId} has failed`
  };
}

function internalServerError(): ApiErrorResponse {
  return {
    error: 'Internal Server Error',
    message: 'An unexpected error occurred on the server.'
  };
};

function videoNotFoundError(videoId: string): ApiErrorResponse {
  return {
    error: 'Video not found',
    message: `Video with ID ${videoId} does not exist`
  };
};
