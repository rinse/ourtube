'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { parseHLSDuration, formatDuration } from '../utils/video-duration';
import { apiFetch } from '../lib/api';
import DeleteVideoDialog from './DeleteVideoDialog';

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

export default function VideoList() {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [durations, setDurations] = useState<Record<string, number | null>>({});
  const [deleteDialog, setDeleteDialog] = useState<{ isOpen: boolean; video: Video | null }>({ isOpen: false, video: null });

  // Fetch durations for ready videos
  const fetchDurations = useCallback(async (videos: Video[]) => {
    const readyVideos = videos.filter(v => v.status === 'ready');
    const newDurations: Record<string, number | null> = {};
    
    await Promise.all(
      readyVideos.map(async (video) => {
        if (!durations[video.id]) {
          const duration = await parseHLSDuration(video.hlsUrl);
          newDurations[video.id] = duration;
        }
      })
    );
    
    if (Object.keys(newDurations).length > 0) {
      setDurations(prev => ({ ...prev, ...newDurations }));
    }
  }, [durations]);

  const handleDeleteVideo = async () => {
    if (!deleteDialog.video) return;

    try {
      const response = await apiFetch(`/api/videos/${deleteDialog.video.id}`, {
        method: 'DELETE',
      });

      if (!response.ok) {
        throw new Error('Failed to delete video');
      }

      // Remove video from the list
      setVideos(prev => prev.filter(v => v.id !== deleteDialog.video!.id));
      setDeleteDialog({ isOpen: false, video: null });
    } catch (error) {
      console.error('Error deleting video:', error);
      alert('Failed to delete video. Please try again.');
    }
  };

  useEffect(() => {
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
  }, [fetchDurations]);

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
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 md:gap-6">
        {videos.map((video) => {
        const isReady = video.status === 'ready';
        const isConverting = video.status === 'converting';
        
        return isReady ? (
          <Link
            key={video.id}
            href={`/videos?id=${video.id}`}
            className={`bg-white rounded-lg shadow-md overflow-hidden transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 hover:shadow-lg hover:scale-[1.02] cursor-pointer`}
          >
          {/* Video Thumbnail */}
          <div className="w-full aspect-video bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 relative group">
            {video.thumbnailUrl ? (
              <Image 
                src={video.thumbnailUrl} 
                alt={video.title}
                className="object-cover"
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                  // Hide the broken image and show the fallback
                  e.currentTarget.style.display = 'none';
                  e.currentTarget.nextElementSibling?.classList.remove('hidden');
                }}
              />
            ) : null}
            <div className={`absolute inset-0 flex items-center justify-center ${video.thumbnailUrl ? 'hidden' : ''}`}>
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
            {/* Duration badge */}
            <div className="absolute bottom-2 right-2 bg-black bg-opacity-75 text-white text-xs px-2 py-1 rounded">
              {formatDuration(durations[video.id])}
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
          </Link>
        ) : (
          <div 
            key={video.id}
            className={`bg-white rounded-lg shadow-md overflow-hidden transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 cursor-not-allowed opacity-75`}
          >
          {/* Video Thumbnail */}
          <div className="w-full aspect-video bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 relative group">
            {video.thumbnailUrl ? (
              <Image 
                src={video.thumbnailUrl}
                alt={video.title}
                className="object-cover"
                fill
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
              />
            ) : (
              <div className="w-full h-full flex items-center justify-center">
                <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              </div>
            )}
            
            {/* Play Button Overlay */}
            <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-0 group-hover:bg-opacity-30 transition-all duration-200">
              <div className="bg-white rounded-full p-3 opacity-0 group-hover:opacity-100 transform scale-50 group-hover:scale-100 transition-all duration-200 shadow-lg">
                <svg className="w-6 h-6 text-gray-800" fill="currentColor" viewBox="0 0 24 24">
                  <path d="M8 5v14l11-7z"/>
                </svg>
              </div>
            </div>
            
            {/* Status Badge */}
            {video.status === 'failed' ? (
              <button
                className="absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium bg-red-100 text-red-800 hover:bg-red-200 transition-colors cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteDialog({ isOpen: true, video });
                }}
              >
                <span className="flex items-center">
                  Failed
                  <svg className="w-3 h-3 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </span>
              </button>
            ) : (
              <div className={`absolute top-2 right-2 px-2 py-1 rounded-full text-xs font-medium ${
                video.status === 'ready' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
              }`}>
                {video.status === 'ready' ? 'Ready' : 'Converting'}
              </div>
            )}
          </div>
          
          {/* Video Info */}
          <div className="p-4">
            <h3 className="text-lg font-semibold text-gray-800 mb-2 line-clamp-2">
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
                  <svg className="w-3 h-3 mr-1 animate-spin" fill="currentColor" viewBox="0 0 24 24">
                    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z"/>
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
          </div>
        );
      })}
      </div>
      
      <DeleteVideoDialog
        isOpen={deleteDialog.isOpen}
        videoTitle={deleteDialog.video?.title || ''}
        onConfirm={handleDeleteVideo}
        onCancel={() => setDeleteDialog({ isOpen: false, video: null })}
      />
    </>
  );
}