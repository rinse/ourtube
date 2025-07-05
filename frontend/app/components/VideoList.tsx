'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';

interface Video {
  id: string;
  title: string;
  hlsUrl: string;
  status: 'converting' | 'ready' | 'failed';
}

interface VideoListResponse {
  videos: Video[];
  count: number;
}

export default function VideoList() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchVideos = () => {
      fetch('/api/videos')
        .then(res => {
          if (!res.ok) {
            throw new Error('Failed to fetch videos');
          }
          return res.json();
        })
        .then((data: VideoListResponse) => {
          setVideos(data.videos);
          setLoading(false);
        })
        .catch(err => {
          setError(err.message);
          setLoading(false);
        });
    };

    // Initial fetch
    fetchVideos();

    // Refresh every 5 seconds if there are converting videos
    const interval = setInterval(() => {
      const hasConvertingVideos = videos.some(v => v.status === 'converting');
      if (hasConvertingVideos) {
        fetchVideos();
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [videos]);

  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
        {[...Array(8)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow-md overflow-hidden animate-pulse">
            <div className="w-full aspect-video bg-gray-200"></div>
            <div className="p-4">
              <div className="h-5 bg-gray-200 rounded w-3/4 mb-2"></div>
              <div className="h-4 bg-gray-200 rounded w-1/2"></div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <div className="col-span-full flex justify-center">
          <div className="bg-white rounded-lg shadow-md p-6 text-center max-w-md">
            <div className="text-red-600">
              <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <h2 className="text-xl font-semibold mb-2">Error Loading Videos</h2>
              <p className="text-sm">{error}</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="grid grid-cols-1 gap-4">
        <div className="col-span-full flex justify-center">
          <div className="bg-white rounded-lg shadow-md p-6 text-center max-w-md">
            <div className="text-gray-500">
              <svg className="w-16 h-16 mx-auto mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 002 2v8a2 2 0 002 2z" />
              </svg>
              <h2 className="text-xl font-semibold mb-2">No Videos Available</h2>
              <p className="text-sm">There are no videos to display at the moment.</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
      {videos.map((video) => {
        const isReady = video.status === 'ready';
        const isConverting = video.status === 'converting';
        
        const CardWrapper = isReady ? Link : 'div';
        const cardProps = isReady ? { href: `/videos/${video.id}` } : {};
        
        return (
          <CardWrapper 
            key={video.id}
            {...cardProps}
            className={`bg-white rounded-lg shadow-md overflow-hidden transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 ${
              isReady ? 'hover:shadow-lg hover:scale-[1.02] cursor-pointer' : 'cursor-not-allowed opacity-75'
            }`}
          >
          {/* Video Thumbnail */}
          <div className="w-full aspect-video bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 relative group">
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="text-center text-gray-600">
                <svg className="w-8 h-8 md:w-12 md:h-12 mx-auto mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 002 2v8a2 2 0 002 2z" />
                </svg>
                <p className="text-xs font-medium">Thumbnail</p>
              </div>
            </div>
            {/* Play button overlay */}
            <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-black bg-opacity-20">
              <div className="bg-white bg-opacity-90 rounded-full p-2 md:p-3 shadow-lg">
                <svg className="w-5 h-5 md:w-6 md:h-6 text-gray-800" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            </div>
            {/* Duration badge (placeholder) */}
            <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
              --:--
            </div>
          </div>
          
          {/* Video Info */}
          <div className="p-3 md:p-4">
            <h3 className="text-sm md:text-base font-semibold text-gray-800 mb-1 line-clamp-2 leading-tight">
              {video.title}
            </h3>
            <p className="text-xs text-gray-600 mb-1">
              Video ID: {video.id.substring(0, 8)}...
            </p>
            <div className={`flex items-center text-xs ${
              isReady ? 'text-green-600' : isConverting ? 'text-yellow-600' : 'text-red-600'
            }`}>
              {isReady ? (
                <>
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
                  </svg>
                  Ready to Play
                </>
              ) : isConverting ? (
                <>
                  <svg className="w-3 h-3 mr-1 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  Converting...
                </>
              ) : (
                <>
                  <svg className="w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                  </svg>
                  Conversion Failed
                </>
              )}
            </div>
          </div>
        </CardWrapper>
        );
      })}
    </div>
  );
}