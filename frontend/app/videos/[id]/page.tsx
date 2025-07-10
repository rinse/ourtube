'use client';

import VideoPlayer from '../../components/VideoPlayer';
import VideoListSidebar from '../../components/VideoListSidebar';
import Header from '../../components/Header';
import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface VideoInfo {
  id: string;
  title: string;
  hlsUrl: string;
}

interface PageProps {
  params: Promise<{ id: string }>;
}

export default function VideoPage({ params }: PageProps) {
  const router = useRouter();
  const [videoId, setVideoId] = useState<string>('');
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  useEffect(() => {
    params.then(({ id }) => {
      setVideoId(id);
      setLoading(true);
      setError(null);

      fetch(`/api/videos/${id}`)
        .then(res => {
          if (!res.ok) {
            throw new Error('Failed to fetch video info');
          }
          return res.json();
        })
        .then(data => {
          setVideoInfo(data);
          setEditTitle(data.title);
          setLoading(false);
        })
        .catch(err => {
          setError(err.message);
          setLoading(false);
        });
    });
  }, [params]);

  // Toast auto-hide
  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleDelete = async () => {
    if (!videoId) return;
    
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/videos/${videoId}`, {
        method: 'DELETE',
      });
      
      const data = await response.json();
      
      if (data.message === 'ok') {
        router.push('/');
      } else {
        setToast({ message: data.reason || 'Failed to delete video', type: 'error' });
      }
    } catch {
      setToast({ message: 'Network error occurred', type: 'error' });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleEditStart = () => {
    setIsEditing(true);
    setEditTitle(videoInfo?.title || '');
  };

  const handleEditCancel = () => {
    setIsEditing(false);
    setEditTitle(videoInfo?.title || '');
  };

  const handleEditConfirm = async () => {
    if (!videoId || !editTitle.trim()) return;
    
    setIsUpdating(true);
    try {
      const response = await fetch(`/api/videos/${videoId}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      
      const data = await response.json();
      
      if (data.message === 'ok') {
        setVideoInfo(prev => prev ? { ...prev, title: editTitle.trim() } : null);
        setIsEditing(false);
        setToast({ message: 'Title updated successfully', type: 'success' });
      } else {
        setToast({ message: data.reason || 'Failed to update title', type: 'error' });
        setEditTitle(videoInfo?.title || '');
      }
    } catch {
      setToast({ message: 'Network error occurred', type: 'error' });
      setEditTitle(videoInfo?.title || '');
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="min-h-screen bg-white sm:bg-gray-100">
      <Header />

      <main className="max-w-7xl mx-auto px-0 sm:px-4 md:px-6 lg:px-8 py-0 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 sm:gap-6">
          {/* Video Player Section - Left Side */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-none sm:rounded-lg shadow-none sm:shadow-lg overflow-hidden">
              {loading ? (
                <div className="p-4">
                  <div className="animate-pulse">
                    <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                    <div className="h-4 bg-gray-200 rounded w-1/2 mt-2"></div>
                  </div>
                </div>
              ) : error ? (
                <div className="p-4 text-red-600">
                  <h2 className="text-xl font-semibold">Error</h2>
                  <p className="text-sm mt-1">{error}</p>
                </div>
              ) : (
                <>
                  {videoId && (
                    <VideoPlayer src={`/api/videos/${videoId}/index.m3u8`} autoPlay={true} />
                  )}
                  
                  <div className="p-4">
                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      <div className="flex-1">
                        {isEditing ? (
                          <div className="flex items-center space-x-2">
                            <input
                              type="text"
                              value={editTitle}
                              onChange={(e) => setEditTitle(e.target.value)}
                              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-base sm:text-lg font-semibold"
                              disabled={isUpdating}
                            />
                            <button
                              onClick={handleEditConfirm}
                              disabled={isUpdating || !editTitle.trim()}
                              className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
                            >
                              {isUpdating ? (
                                <>
                                  <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                  </svg>
                                  Saving...
                                </>
                              ) : (
                                <>
                                  <span className="mr-1">✅</span>
                                  Confirm
                                </>
                              )}
                            </button>
                            <button
                              onClick={handleEditCancel}
                              disabled={isUpdating}
                              className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 disabled:opacity-50"
                            >
                              <span className="mr-1">✕</span>
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <h2 className="text-lg sm:text-xl font-semibold text-gray-800">{videoInfo?.title}</h2>
                        )}
                      </div>
                      <div className="flex items-center space-x-2">
                        {!isEditing && (
                          <button
                            onClick={handleEditStart}
                            className="inline-flex items-center px-3 py-2 border border-gray-300 text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
                          >
                            <span className="mr-1">🖊</span>
                            Edit
                          </button>
                        )}
                        <button
                          onClick={() => setShowDeleteConfirm(true)}
                          className="inline-flex items-center px-3 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500"
                        >
                          <span className="mr-1">🗑</span>
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* Video List Sidebar - Right Side */}
          <div className="lg:col-span-1">
            <VideoListSidebar currentVideoId={videoId} />
          </div>
        </div>
      </main>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3 text-center">
              <h3 className="text-lg font-medium text-gray-900">Delete Video</h3>
              <div className="mt-2 px-7 py-3">
                <p className="text-sm text-gray-500">
                  Are you sure you want to delete this video? This action cannot be undone.
                </p>
              </div>
              <div className="items-center px-4 py-3">
                <div className="flex space-x-3">
                  <button
                    onClick={() => setShowDeleteConfirm(false)}
                    disabled={isDeleting}
                    className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 text-base font-medium rounded-md shadow-sm hover:bg-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-300 disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleDelete}
                    disabled={isDeleting}
                    className="flex-1 px-4 py-2 bg-red-600 text-white text-base font-medium rounded-md shadow-sm hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 disabled:opacity-50"
                  >
                    {isDeleting ? (
                      <>
                        <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white inline" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Deleting...
                      </>
                    ) : (
                      'Delete'
                    )}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <div className={`rounded-md p-4 shadow-lg ${
            toast.type === 'error' ? 'bg-red-100 border border-red-400' : 'bg-green-100 border border-green-400'
          }`}>
            <div className="flex">
              <div className="flex-shrink-0">
                {toast.type === 'error' ? (
                  <svg className="h-5 w-5 text-red-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                ) : (
                  <svg className="h-5 w-5 text-green-400" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                )}
              </div>
              <div className="ml-3">
                <p className={`text-sm font-medium ${
                  toast.type === 'error' ? 'text-red-800' : 'text-green-800'
                }`}>
                  {toast.message}
                </p>
              </div>
              <div className="ml-auto pl-3">
                <div className="-mx-1.5 -my-1.5">
                  <button
                    onClick={() => setToast(null)}
                    className={`inline-flex rounded-md p-1.5 focus:outline-none focus:ring-2 focus:ring-offset-2 ${
                      toast.type === 'error' 
                        ? 'text-red-500 hover:bg-red-200 focus:ring-red-600' 
                        : 'text-green-500 hover:bg-green-200 focus:ring-green-600'
                    }`}
                  >
                    <span className="sr-only">Dismiss</span>
                    <svg className="h-5 w-5" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                    </svg>
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}