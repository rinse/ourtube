'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { formatDuration } from '../utils/video-duration';
import { useVideoDurations } from '../utils/useVideoDurations';
import { apiFetch } from '../lib/api';

interface Video {
  id: string;
  title: string;
  hlsUrl: string;
  status: 'converting' | 'ready' | 'failed';
  thumbnailUrl?: string | null;
  duration?: number | null;
}

interface VideoListResponse {
  videos: Video[];
  count: number;
}

interface PlaylistDetailResponse {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  videos: Video[];
}

interface VideoListSidebarProps {
  currentVideoId?: string;
  playlistId?: string;
}

export default function VideoListSidebar({ currentVideoId, playlistId }: VideoListSidebarProps) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const { durations, fetchDurations } = useVideoDurations();

  useEffect(() => {
    setLoading(true);
    setError(null);

    if (playlistId) {
      apiFetch(`/api/playlists/${playlistId}`)
        .then(res => {
          if (!res.ok) {
            throw new Error('Failed to fetch playlist');
          }
          return res.json();
        })
        .then((data: PlaylistDetailResponse) => {
          setVideos(data.videos);
          setLoading(false);
          fetchDurations(data.videos);
        })
        .catch(err => {
          setError(err.message);
          setLoading(false);
        });
      return;
    }

    let intervalId: NodeJS.Timeout | null = null;

    const fetchVideos = () => {
      apiFetch('/api/videos')
        .then(res => {
          if (!res.ok) {
            throw new Error('Failed to fetch videos');
          }
          return res.json();
        })
        .then((data: VideoListResponse) => {
          setVideos(data.videos);
          setLoading(false);

          // Fetch durations for ready videos
          fetchDurations(data.videos);

          // Clear any existing interval
          if (intervalId) {
            clearInterval(intervalId);
            intervalId = null;
          }

          // Only set up interval if there are converting videos
          const hasConvertingVideos = data.videos.some(v => v.status === 'converting');
          if (hasConvertingVideos) {
            intervalId = setInterval(() => {
              fetchVideos();
            }, 5000);
          }
        })
        .catch(err => {
          setError(err.message);
          setLoading(false);
        });
    };

    // Initial fetch
    fetchVideos();

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [fetchDurations, playlistId]);

  if (loading) {
    return (
      <div className="space-y-3">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow-sm overflow-hidden animate-pulse">
            <div className="flex flex-col sm:flex-row">
              <div className="w-full sm:w-1/2 aspect-video bg-gray-200"></div>
              <div className="w-full sm:w-1/2 p-3 flex flex-col justify-center">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2"></div>
                <div className="h-3 bg-gray-200 rounded w-1/2"></div>
              </div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="text-red-600 text-sm">
          <p className="font-semibold mb-1">Error Loading Videos</p>
          <p className="text-xs">{error}</p>
        </div>
      </div>
    );
  }

  if (videos.length === 0) {
    return (
      <div className="bg-white rounded-lg shadow-sm p-4">
        <div className="text-gray-500 text-sm text-center">
          <p className="font-semibold mb-1">No Videos</p>
          <p className="text-xs">No videos available</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {videos.map((video) => {
        const isReady = video.status === 'ready';
        const isCurrentVideo = video.id === currentVideoId;
        
        const videoCard = (
          <div className={`bg-white rounded-lg shadow-sm overflow-hidden transition-all duration-200 ${
            isReady ? 'hover:shadow-md hover:scale-[1.02] cursor-pointer' : 'opacity-75 cursor-not-allowed'
          } ${isCurrentVideo ? 'ring-2 ring-blue-500' : ''} mb-3 last:mb-0`}>
            <div className="flex flex-col sm:flex-row sm:h-24">
              {/* Thumbnail */}
              <div className="w-full sm:w-1/2 aspect-video sm:aspect-auto relative bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400">
                {video.thumbnailUrl ? (
                  <Image 
                    src={video.thumbnailUrl} 
                    alt={video.title}
                    className="object-cover"
                    fill
                    sizes="(max-width: 640px) 100vw, 200px"
                    onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                      e.currentTarget.style.display = 'none';
                      e.currentTarget.nextElementSibling?.classList.remove('hidden');
                    }}
                  />
                ) : null}
                <div className={`absolute inset-0 flex items-center justify-center ${video.thumbnailUrl ? 'hidden' : ''}`}>
                  <svg className="w-8 h-8 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                </div>
                {/* Duration badge */}
                {isReady && durations[video.id] && (
                  <div className="absolute bottom-1 right-1 bg-black bg-opacity-75 text-white text-xs px-1 py-0.5 rounded">
                    {formatDuration(durations[video.id])}
                  </div>
                )}
                {/* Status indicator for non-ready videos */}
                {!isReady && (
                  <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center">
                    {video.status === 'converting' ? (
                      <svg className="w-8 h-8 text-white animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    ) : (
                      <svg className="w-8 h-8 text-red-500" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm1 15h-2v-2h2v2zm0-4h-2V7h2v6z"/>
                      </svg>
                    )}
                  </div>
                )}
              </div>
              
              {/* Title */}
              <div className="w-full sm:w-1/2 p-3 flex flex-col justify-center">
                <h3 className="text-base sm:text-sm font-semibold text-gray-800 line-clamp-2 leading-tight mb-1">
                  {video.title}
                </h3>
                <div className={`text-xs ${
                  isReady ? 'text-green-600' : video.status === 'converting' ? 'text-yellow-600' : 'text-red-600'
                }`}>
                  {isReady ? 'Ready' : video.status === 'converting' ? 'Converting' : 'Failed'}
                </div>
              </div>
            </div>
          </div>
        );

        const href = playlistId
          ? `/videos?id=${video.id}&playlist=${playlistId}`
          : `/videos?id=${video.id}`;

        return isReady ? (
          <Link key={video.id} href={href} className="block">
            {videoCard}
          </Link>
        ) : (
          <div key={video.id}>
            {videoCard}
          </div>
        );
      })}
    </div>
  );
}