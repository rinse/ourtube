# Video Streaming Service - Backend

## Overview
This is the backend API server for the video streaming service, built with Express.js and TypeScript.

## Tech Stack
- Express.js 5.x
- TypeScript 5.x
- Node.js

## API Endpoints

### Base URL
- Development: `http://localhost:4000`

### Available Endpoints
- `GET /api` - Welcome message and API status
- `GET /api/health` - Health check endpoint

## Development Setup

### Prerequisites
- Node.js (v18 or higher recommended)
- npm

### Installation
```bash
cd backend
npm install
```

### Running the Development Server
```bash
npm run dev
```

The server will start on port 4000 by default. You can access the API at:
- http://localhost:4000/api

### Building for Production
```bash
npm run build
npm start
```

## Project Structure
```
backend/
├── src/
│   └── app.ts         # Express application entry point
├── dist/              # Compiled JavaScript output (generated)
├── node_modules/      # Dependencies (generated)
├── .gitignore
├── nodemon.json       # Nodemon configuration
├── package.json       # Project dependencies and scripts
├── README.md          # This file
└── tsconfig.json      # TypeScript configuration
```

## Scripts
- `npm run dev` - Start development server with hot reload
- `npm run build` - Compile TypeScript to JavaScript
- `npm start` - Run production server

## Environment Variables
- `PORT` - Server port (default: 4000)
- `NODE_ENV` - Environment mode (development/production)