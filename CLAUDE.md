# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A YouTube-like video streaming service built with modern web technologies. The service supports video upload, automatic HLS conversion, and streaming playback optimized for mobile devices.

## Architecture

### Technology Stack
- **Frontend**: Next.js 15.3.5 (App Router), React 19, TypeScript, Tailwind CSS
- **Backend**: Express.js 5.x, TypeScript, SQLite3, Multer
- **Video Processing**: ffmpeg for HLS conversion, SHA256 for video ID generation
- **Streaming**: HLS.js for adaptive bitrate streaming

### Project Structure
```
videoplayer/
├── frontend/          # Next.js application
│   ├── app/          # App Router pages and components
│   │   ├── components/   # Reusable components
│   │   ├── upload/      # Upload page
│   │   └── videos/      # Video player pages
│   └── next.config.ts   # API proxy configuration
└── backend/           # Express.js API server
    ├── src/          # TypeScript source files
    │   ├── app.ts           # Main application
    │   ├── database.ts      # SQLite database layer
    │   └── video-processor.ts # Video conversion logic
    ├── uploads/      # Temporary upload storage
    ├── videos/       # Converted HLS video storage
    └── videos.db     # SQLite database file

## Development Commands

### Frontend (Port 3000)
```bash
cd frontend
npm install
npm run dev    # Development server
npm run build  # Production build
npm run lint   # ESLint
```

### Backend (Port 4000)
```bash
cd backend
npm install
npm run dev    # Development server with nodemon
npm run build  # TypeScript compilation
npm start      # Production server
```

## Server Process Management

Kill existing processes if ports are occupied:

```bash
# Quick cleanup
lsof -ti:3000 | xargs kill -9  # Frontend
lsof -ti:4000 | xargs kill -9  # Backend
```

## Database Schema

SQLite database (`videos.db`) with single table:

```sql
CREATE TABLE videos (
  id TEXT PRIMARY KEY,              -- SHA256 hash of video file
  title TEXT NOT NULL,              -- Video title
  folder TEXT NOT NULL,             -- Storage folder (same as id)
  status TEXT NOT NULL DEFAULT 'converting',  -- converting|ready|failed
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
);
```

## API Endpoints

### General
- `GET /api` - Service status
- `GET /api/health` - Health check

### Video Operations
- `GET /api/videos` - List all videos with status
  ```json
  {
    "videos": [
      {
        "id": "sha256_hash",
        "title": "Video Title",
        "hlsUrl": "/api/videos/sha256_hash",
        "status": "ready"
      }
    ],
    "count": 1
  }
  ```

- `GET /api/videos/:videoid` - HLS manifest (.m3u8)
- `GET /api/videos/:videoid/:filename` - HLS segments (.ts, .vtt, .m3u8)
- `GET /api/videos/:videoid/info` - Video metadata

### Upload & Conversion
- `POST /api/upload` - Upload video (multipart/form-data)
  - Field: `video` (file)
  - Field: `title` (string, optional)
  - Returns: `{ videoId, title, status: "converting" }`
  
- `GET /api/conversion-status/:videoid` - Individual conversion status
- `GET /api/conversion-status` - All conversion jobs

## Video Processing Flow

1. **Upload**: Video uploaded to `backend/uploads/` (temporary)
2. **ID Generation**: SHA256 hash of file content becomes video ID
3. **Database Entry**: Record created with `status: 'converting'`
4. **Background Conversion**: ffmpeg converts to HLS format
   ```bash
   ffmpeg -i input.mp4 -c:v libx264 -c:a aac \
     -hls_time 10 -hls_list_size 0 -hls_playlist_type vod \
     -f hls output/index.m3u8
   ```
5. **Storage**: HLS files saved to `backend/videos/<video-id>/`
6. **Status Update**: Database updated to `status: 'ready'`
7. **Cleanup**: Original upload file deleted

## Frontend Features

### Video List (`/`)
- Auto-refreshes every 5 seconds if converting videos exist
- Shows status indicators:
  - ✅ Ready: Clickable, green checkmark
  - ⏳ Converting: Not clickable, spinning loader
  - ❌ Failed: Not clickable, error icon

### Upload Page (`/upload`)
- File selection via dialog or path input
- Optional title (uses filename if empty)
- Duplicate detection via SHA256
- Loading states and error handling

### Video Player (`/videos/[id]`)
- HLS.js integration
- Mobile-optimized layout
- Fullscreen support
- Error recovery

## Common Tasks

### Add Sample Video Manually
```bash
# 1. Convert video to HLS
ffmpeg -i input.mp4 -f hls -hls_time 10 -hls_list_size 0 \
  -hls_playlist_type vod backend/videos/VIDEO_ID/index.m3u8

# 2. Update database
cd backend
node dist/migrate-sample.js
```

### Debug Video Issues
- Check video status: `sqlite3 backend/videos.db "SELECT * FROM videos;"`
- Check conversion logs: Backend console output
- Verify HLS files: `ls backend/videos/<video-id>/`
- Test manifest: `curl http://localhost:4000/api/videos/<video-id>`

## Important Notes

- Maximum upload size: 5GB (configurable in `app.ts`)
- Supported formats: Any video/* MIME type
- Frontend auto-proxies `/api/*` to backend port 4000
- All timestamps use ISO 8601 format
- Video IDs are immutable (based on file content)
