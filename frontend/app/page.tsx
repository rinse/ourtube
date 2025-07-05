'use client';

import VideoPlayer from './components/VideoPlayer';
import { useState, useEffect } from 'react';

interface VideoInfo {
  id: string;
  title: string;
  hlsUrl: string;
}

export default function Home() {
  const videoId = 'fa7014331597dba179a75a3ddf0dcaf0fd4f989faaa82957ef2c824743097d2b';
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/videos/${videoId}/info`)
      .then(res => {
        if (!res.ok) {
          throw new Error('Failed to fetch video info');
        }
        return res.json();
      })
      .then(data => {
        setVideoInfo(data);
        setLoading(false);
      })
      .catch(err => {
        setError(err.message);
        setLoading(false);
      });
  }, [videoId]);
  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4">
            <h1 className="text-2xl font-bold text-gray-900">Video Streaming Service</h1>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="bg-white rounded-lg shadow-lg overflow-hidden">
          <div className="p-4 border-b">
            {loading ? (
              <div className="animate-pulse">
                <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                <div className="h-4 bg-gray-200 rounded w-1/2 mt-2"></div>
              </div>
            ) : error ? (
              <div className="text-red-600">
                <h2 className="text-xl font-semibold">Error</h2>
                <p className="text-sm mt-1">{error}</p>
              </div>
            ) : (
              <>
                <h2 className="text-xl font-semibold text-gray-800">{videoInfo?.title}</h2>
                <p className="text-gray-600 text-sm mt-1">HLS streaming test with mobile support</p>
              </>
            )}
          </div>
          
          {!loading && !error && (
            <VideoPlayer src={`/api/videos/${videoId}`} />
          )}
          
          <div className="p-4">
            <h3 className="font-semibold text-gray-800 mb-2">Video Details</h3>
            <p className="text-gray-600 text-sm">
              This is a sample HLS video stream. The player supports:
            </p>
            <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
              <li>HLS adaptive streaming</li>
              <li>Mobile portrait layout</li>
              <li>Fullscreen with landscape orientation</li>
              <li>Native browser controls</li>
            </ul>
          </div>
        </div>

        <div className="mt-8 bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-4">Instructions</h2>
          <div className="space-y-2 text-sm text-gray-600">
            <p>• Tap the video to play/pause</p>
            <p>• Use the fullscreen button to enter landscape mode</p>
            <p>• The player automatically handles HLS streaming</p>
            <p>• Works on both desktop and mobile devices</p>
          </div>
        </div>
      </main>
    </div>
  );
}