# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a video streaming service with a YouTube-like design, built for mobile viewing with portrait layout and landscape fullscreen playback. The project consists of separate frontend and backend applications.

## Architecture

- **Frontend**: Next.js 15.3.5 with React 19, TypeScript, and Tailwind CSS
- **Backend**: Express.js 5.x with TypeScript
- **Future Implementation**: HLS video streaming, ffmpeg conversion, SQLite database
- **Design Pattern**: Planned DI (dependency injection) architecture for swappable storage and database components

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

**Important**: Kill existing server processes if you find the server is already running and the port is occupied.

```bash
# Check for running processes on specific ports
lsof -ti:3000 | xargs kill -9  # Kill frontend process on port 3000
lsof -ti:4000 | xargs kill -9  # Kill backend process on port 4000

# Or check and kill by process name
pkill -f "npm run dev"
pkill -f "next dev"
pkill -f "nodemon"
```

## API Endpoints

- `GET /api` - Welcome message and status
- `GET /api/health` - Health check endpoint

## Video Storage and Conversion

- Videos are stored in `resources/` directory (git-ignored)
- Convert videos to HLS format using ffmpeg:
```bash
ffmpeg -i resources/<video-filename> -f hls -hls_time 10 -hls_list_size 0 -hls_playlist_type vod backend/videos/<videoid>/index.m3u8
```

**Important**:
- The `-hls_playlist_type vod` flag ensures the `#EXT-X-ENDLIST` tag is added to the manifest, which makes the video start from the beginning (00:00) instead of the end

## Key Technical Decisions

- Video IDs will use SHA256 hashes for unique identification
- Mobile-first design with portrait layout
- HLS format for video streaming
- ffmpeg for background video conversion
- File system storage for videos, SQLite for metadata

## Implementation Status

The project is in early stages with basic frontend and backend scaffolding complete. The main README.md contains a detailed implementation roadmap in Japanese, outlining the step-by-step development plan from basic setup through full video streaming functionality.
