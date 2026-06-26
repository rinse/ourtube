import express, { Express, Request, Response, NextFunction } from 'express';
import { Dependencies } from './dependencies';
import { createAuth } from './auth';
import { ApiErrorResponse, DeleteVideoResponse, UpdateVideoResponse, SuggestVideoTitleResponse, OkResponse } from './api-schemas';
import { listVideos } from './api/videos/list';
import { getVideo } from './api/videos/get';
import { getVideoFile, VideoFile } from './api/videos/video/file';
import { deleteVideo } from './api/videos/video/delete';
import { updateVideoTitle } from './api/videos/update';
import { createUpload, completeUpload } from './api/upload';
import { suggetVideoTitle } from './api/suggest-video-title';
import { listPlaylists } from './api/playlists/list';
import { createPlaylist } from './api/playlists/create';
import { getPlaylist } from './api/playlists/get';
import { renamePlaylist } from './api/playlists/update';
import { deletePlaylist } from './api/playlists/delete';
import { addPlaylistVideo, removePlaylistVideo, reorderPlaylistVideos } from './api/playlists/members';
import { IllegalArgumentError } from './utils';

/**
 * Build the Express app from injected dependencies. No network I/O here so the
 * same factory serves both the local server (src/server.ts) and the Lambda
 * adapter (src/lambda/api.ts).
 */
export function createApp(deps: Dependencies): Express {
  const app = express();
  const auth = createAuth(deps.config);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // --- Everything under /api requires a valid platform session ---
  // There is no local login/logout: the shared `.app.esnir.net` session cookie
  // is minted by auth.app.esnir.net and verified here against its public JWKS.
  app.use('/api', auth.guard);

  app.get('/api/videos', async (_req: Request, res: Response) => {
    try {
      res.json(await listVideos(deps));
    } catch (error) {
      console.error('Error on GET /api/videos', error);
      res.status(500).json(internalServerError());
    }
  });

  app.get('/api/videos/:videoId', async (req: Request, res: Response) => {
    const { videoId } = req.params;
    try {
      const video = await getVideo(deps, videoId);
      if (video == null) {
        res.status(404).json(videoNotFoundError(videoId));
        return;
      }
      res.json(video);
    } catch (error) {
      console.error(`Error on GET /api/videos/${videoId}`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.delete('/api/videos/:videoId', async (req: Request, res: Response) => {
    const { videoId } = req.params;
    try {
      const isDeleted = await deleteVideo(deps, videoId);
      if (!isDeleted) {
        res.status(404).json(videoNotFoundError(videoId));
        return;
      }
      res.json({ message: 'ok' } satisfies DeleteVideoResponse);
    } catch (error) {
      console.error(`Error on DELETE /api/videos/${videoId}`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.put('/api/videos/:videoId', async (req: Request, res: Response) => {
    const { videoId } = req.params;
    const { title } = req.body;
    if (typeof title !== 'string') {
      res.status(400).json({ error: 'Invalid input', message: 'Title is required and must be a string' } satisfies ApiErrorResponse);
      return;
    }
    try {
      const isUpdated = await updateVideoTitle(deps, videoId, title);
      if (!isUpdated) {
        res.status(404).json(videoNotFoundError(videoId));
        return;
      }
      res.json({ message: 'ok' } satisfies UpdateVideoResponse);
    } catch (error) {
      console.error(`Error on PUT /api/videos/${videoId}`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.get('/api/videos/:videoId/:filename', async (req: Request, res: Response) => {
    const { videoId, filename } = req.params;
    let file: VideoFile | null;
    try {
      file = await getVideoFile(deps, videoId, filename);
    } catch (error: unknown) {
      if (error instanceof IllegalArgumentError) {
        res.status(400).json({ error: 'Invalid file type', message: error.message } satisfies ApiErrorResponse);
        return;
      }
      console.error(`Error on GET /api/videos/${videoId}/${filename}`, error);
      res.status(500).json(internalServerError());
      return;
    }
    if (file == null) {
      res.status(404).json(videoNotFoundError(videoId));
      return;
    }
    switch (file.status) {
      case 'ready':
        switch (file.kind) {
          case 'manifest':
            res.setHeader('Content-Type', file.mime);
            res.setHeader('Cache-Control', 'no-store');
            res.send(file.body);
            return;
          case 'redirect':
            res.redirect(302, file.url);
            return;
          case 'stream':
            res.setHeader('Content-Type', file.mime);
            // thumbnail.jpg is content-addressed (immutable per video id) so a
            // long-lived, immutable Cache-Control is safe — both for the
            // browser and for the edge-cached CloudFront behavior dedicated to
            // this path (infra/lib/videoplayer-stack.ts), which lets repeat
            // list-page visits skip the API Lambda entirely (issue #65).
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
            file.stream.pipe(res);
            return;
        }
        return;
      case 'converting':
        res.status(503).json({ error: 'Video not ready', message: `Video ${videoId} is still converting` } satisfies ApiErrorResponse);
        return;
      case 'failed':
        res.status(400).json({ error: 'Video not available', message: `Video conversion for ${videoId} has failed` } satisfies ApiErrorResponse);
        return;
    }
  });

  app.post('/api/uploads', async (req: Request, res: Response) => {
    const { sha256, fileName, title, contentType } = req.body ?? {};
    if (typeof sha256 !== 'string' || typeof fileName !== 'string') {
      res.status(400).json({ error: 'Invalid input', message: 'sha256 and fileName are required' } satisfies ApiErrorResponse);
      return;
    }
    try {
      const response = await createUpload(deps, { sha256, fileName, title, contentType });
      if (response == null) {
        res.status(409).json({ error: 'Video already exists', message: 'This video has already been uploaded' } satisfies ApiErrorResponse);
        return;
      }
      res.status(201).location(`/api/videos/${response.videoId}`).json(response);
    } catch (error) {
      if (error instanceof IllegalArgumentError) {
        res.status(400).json({ error: 'Invalid input', message: error.message } satisfies ApiErrorResponse);
        return;
      }
      console.error('Error on POST /api/uploads', error);
      res.status(500).json(internalServerError());
    }
  });

  app.post('/api/uploads/:videoId/complete', async (req: Request, res: Response) => {
    const { videoId } = req.params;
    try {
      const started = await completeUpload(deps, videoId);
      if (!started) {
        res.status(404).json(videoNotFoundError(videoId));
        return;
      }
      res.status(202).json({ message: 'ok' });
    } catch (error) {
      console.error(`Error on POST /api/uploads/${videoId}/complete`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.post('/api/suggest-video-title', async (req: Request, res: Response) => {
    const { fileName } = req.body ?? {};
    if (!fileName || typeof fileName !== 'string') {
      res.status(400).json({ error: 'Invalid input', message: 'fileName is required in request body' } satisfies ApiErrorResponse);
      return;
    }
    try {
      const title = await suggetVideoTitle(deps, fileName);
      res.json({ suggestedTitle: title } satisfies SuggestVideoTitleResponse);
    } catch (error) {
      if (error instanceof IllegalArgumentError) {
        res.status(400).json({ error: 'Invalid input', message: error.message } satisfies ApiErrorResponse);
        return;
      }
      console.error('Error on POST /api/suggest-video-title', error);
      res.status(500).json(internalServerError());
    }
  });

  // --- Playlists (all session-guarded by the app.use('/api', auth.guard) above) ---

  app.get('/api/playlists', async (_req: Request, res: Response) => {
    try {
      res.json(await listPlaylists(deps));
    } catch (error) {
      console.error('Error on GET /api/playlists', error);
      res.status(500).json(internalServerError());
    }
  });

  app.post('/api/playlists', async (req: Request, res: Response) => {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name === '') {
      res.status(400).json({ error: 'Invalid input', message: 'name is required and must be a non-empty string' } satisfies ApiErrorResponse);
      return;
    }
    try {
      res.status(201).json(await createPlaylist(deps, name));
    } catch (error) {
      console.error('Error on POST /api/playlists', error);
      res.status(500).json(internalServerError());
    }
  });

  app.get('/api/playlists/:playlistId', async (req: Request, res: Response) => {
    const { playlistId } = req.params;
    try {
      const playlist = await getPlaylist(deps, playlistId);
      if (playlist == null) {
        res.status(404).json(playlistNotFoundError(playlistId));
        return;
      }
      res.json(playlist);
    } catch (error) {
      console.error(`Error on GET /api/playlists/${playlistId}`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.put('/api/playlists/:playlistId', async (req: Request, res: Response) => {
    const { playlistId } = req.params;
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (name === '') {
      res.status(400).json({ error: 'Invalid input', message: 'name is required and must be a non-empty string' } satisfies ApiErrorResponse);
      return;
    }
    try {
      const updated = await renamePlaylist(deps, playlistId, name);
      if (!updated) {
        res.status(404).json(playlistNotFoundError(playlistId));
        return;
      }
      res.json({ message: 'ok' } satisfies OkResponse);
    } catch (error) {
      console.error(`Error on PUT /api/playlists/${playlistId}`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.delete('/api/playlists/:playlistId', async (req: Request, res: Response) => {
    const { playlistId } = req.params;
    try {
      const deleted = await deletePlaylist(deps, playlistId);
      if (!deleted) {
        res.status(404).json(playlistNotFoundError(playlistId));
        return;
      }
      res.json({ message: 'ok' } satisfies OkResponse);
    } catch (error) {
      console.error(`Error on DELETE /api/playlists/${playlistId}`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.post('/api/playlists/:playlistId/videos', async (req: Request, res: Response) => {
    const { playlistId } = req.params;
    const videoId = typeof req.body?.videoId === 'string' ? req.body.videoId : '';
    if (videoId === '') {
      res.status(400).json({ error: 'Invalid input', message: 'videoId is required and must be a string' } satisfies ApiErrorResponse);
      return;
    }
    try {
      const result = await addPlaylistVideo(deps, playlistId, videoId);
      switch (result) {
        case 'ok':
          res.json({ message: 'ok' } satisfies OkResponse);
          return;
        case 'playlist_not_found':
          res.status(404).json(playlistNotFoundError(playlistId));
          return;
        case 'video_not_found':
          res.status(404).json(videoNotFoundError(videoId));
          return;
      }
    } catch (error) {
      console.error(`Error on POST /api/playlists/${playlistId}/videos`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.delete('/api/playlists/:playlistId/videos/:videoId', async (req: Request, res: Response) => {
    const { playlistId, videoId } = req.params;
    try {
      const removed = await removePlaylistVideo(deps, playlistId, videoId);
      if (!removed) {
        res.status(404).json(playlistNotFoundError(playlistId));
        return;
      }
      res.json({ message: 'ok' } satisfies OkResponse);
    } catch (error) {
      console.error(`Error on DELETE /api/playlists/${playlistId}/videos/${videoId}`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.put('/api/playlists/:playlistId/videos', async (req: Request, res: Response) => {
    const { playlistId } = req.params;
    const videoIds = req.body?.videoIds;
    if (!Array.isArray(videoIds) || !videoIds.every((id) => typeof id === 'string')) {
      res.status(400).json({ error: 'Invalid input', message: 'videoIds is required and must be an array of strings' } satisfies ApiErrorResponse);
      return;
    }
    try {
      const reordered = await reorderPlaylistVideos(deps, playlistId, videoIds);
      if (!reordered) {
        res.status(404).json(playlistNotFoundError(playlistId));
        return;
      }
      res.json({ message: 'ok' } satisfies OkResponse);
    } catch (error) {
      if (error instanceof IllegalArgumentError) {
        res.status(400).json({ error: 'Invalid input', message: error.message } satisfies ApiErrorResponse);
        return;
      }
      console.error(`Error on PUT /api/playlists/${playlistId}/videos`, error);
      res.status(500).json(internalServerError());
    }
  });

  app.use((req: Request, res: Response) => {
    res.status(404).json({ error: 'Not Found', message: `Route ${req.method} ${req.path} not found` } satisfies ApiErrorResponse);
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Unhandled error:', err.stack);
    res.status(500).json({ error: 'Internal Server Error', message: 'Something went wrong' } satisfies ApiErrorResponse);
  });

  return app;
}

function internalServerError(): ApiErrorResponse {
  return { error: 'Internal Server Error', message: 'An unexpected error occurred on the server.' };
}

function videoNotFoundError(videoId: string): ApiErrorResponse {
  return { error: 'Video not found', message: `Video with ID ${videoId} does not exist` };
}

function playlistNotFoundError(playlistId: string): ApiErrorResponse {
  return { error: 'Playlist not found', message: `Playlist with ID ${playlistId} does not exist` };
}
