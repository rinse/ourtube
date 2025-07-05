'use client';

import VideoPlayer from '../../components/VideoPlayer';
import { useState, useEffect } from 'react';
import Link from 'next/link';

interface VideoInfo {
  id: string;
  title: string;
  hlsUrl: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function VideoPage({ params }: PageProps) {
  const [videoId, setVideoId] = useState<string>('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    params.then(({ id }) => {
      setVideoId(id);
      setLoading(true);
      setError(null);

      fetch(`/api/videos/${id}/info`)
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
    });
  }, [params]);

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="py-4 flex items-center justify-between">
            <h1 className="text-2xl font-bold text-gray-900">Video Streaming Service</h1>
            <Link
              href="/"
              className="flex items-center space-x-2 text-blue-600 hover:text-blue-800 transition-colors"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              <span>Back to Videos</span>
            </Link>
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
                <p className="text-gray-600 text-sm mt-1">HLS streaming with mobile support</p>
              </>
            )}
          </div>
          
          {!loading && !error && videoId && (
            <VideoPlayer src={`/api/videos/${videoId}`} />
          )}
          
          <div className="p-4">
            <h3 className="font-semibold text-gray-800 mb-2">Video Details</h3>
            <p className="text-gray-600 text-sm">
              This HLS video stream supports:
            </p>
            <ul className="mt-2 text-sm text-gray-600 list-disc list-inside">
              <li>HLS adaptive streaming</li>
              <li>Mobile portrait layout</li>
              <li>Fullscreen with landscape orientation</li>
              <li>Native browser controls</li>
            </ul>
          </div>
        </div>
      </main>
    </div>
  );
}