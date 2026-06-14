'use client';

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import VideoPlayer from '../components/VideoPlayer';
import VideoListSidebar from '../components/VideoListSidebar';
import Header from '../components/Header';
import { apiFetch } from '../lib/api';

interface VideoInfo {
  id: string;
  title: string;
  hlsUrl: string;
}

function VideoDetail({ videoId }: { videoId: string }) {
  const router = useRouter();
  const [videoInfo, setVideoInfo] = useState<VideoInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'error' | 'success' } | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    apiFetch(`/api/videos/${videoId}`)
      .then((res) => {
        if (!res.ok) throw new Error('動画情報の取得に失敗しました');
        return res.json();
      })
      .then((data) => {
        setVideoInfo(data);
        setEditTitle(data.title);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  }, [videoId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await apiFetch(`/api/videos/${videoId}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.message === 'ok') router.push('/');
      else setToast({ message: ' 削除に失敗しました', type: 'error' });
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  const handleEditConfirm = async () => {
    if (!editTitle.trim()) return;
    setIsUpdating(true);
    try {
      const response = await apiFetch(`/api/videos/${videoId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: editTitle.trim() }),
      });
      const data = await response.json();
      if (data.message === 'ok') {
        setVideoInfo((prev) => (prev ? { ...prev, title: editTitle.trim() } : null));
        setIsEditing(false);
        setToast({ message: 'タイトルを更新しました', type: 'success' });
      } else {
        setToast({ message: '更新に失敗しました', type: 'error' });
        setEditTitle(videoInfo?.title || '');
      }
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
      setEditTitle(videoInfo?.title || '');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleSuggestTitle = async () => {
    if (!videoInfo?.title) return;
    setIsSuggesting(true);
    try {
      const response = await apiFetch('/api/suggest-video-title', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileName: videoInfo.title }),
      });
      const data = await response.json();
      if (data.suggestedTitle) {
        setEditTitle(data.suggestedTitle);
        setToast({ message: 'タイトルのサジェストを生成しました', type: 'success' });
      } else {
        setToast({ message: 'サジェストの取得に失敗しました', type: 'error' });
      }
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
    } finally {
      setIsSuggesting(false);
    }
  };

  return (
    <div className="min-h-screen bg-white sm:bg-gray-100">
      <Header />
      <main className="max-w-7xl mx-auto px-0 sm:px-4 md:px-6 lg:px-8 py-0 sm:py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-0 sm:gap-6">
          <div className="lg:col-span-2">
            <div className="bg-white rounded-none sm:rounded-lg shadow-none sm:shadow-lg overflow-hidden">
              {loading ? (
                <div className="p-4"><div className="animate-pulse"><div className="h-6 bg-gray-200 rounded w-3/4" /><div className="h-4 bg-gray-200 rounded w-1/2 mt-2" /></div></div>
              ) : error ? (
                <div className="p-4 text-red-600"><h2 className="text-xl font-semibold">エラー</h2><p className="text-sm mt-1">{error}</p></div>
              ) : (
                <>
                  <VideoPlayer src={`/api/videos/${videoId}/index.m3u8`} autoPlay={true} />
                  <div className="p-4">
                    {isEditing ? (
                      <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                        <input
                          type="text"
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          className="w-full sm:flex-1 px-3 py-2 border border-gray-300 rounded-md text-base sm:text-lg font-semibold"
                          disabled={isUpdating || isSuggesting}
                        />
                        <div className="flex items-center space-x-2">
                          <button onClick={handleEditConfirm} disabled={isUpdating || isSuggesting || !editTitle.trim()} className="px-3 py-2 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50">{isUpdating ? '保存中...' : '確定'}</button>
                          <button onClick={() => { setIsEditing(false); setEditTitle(videoInfo?.title || ''); }} disabled={isUpdating || isSuggesting} className="px-3 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
                          <button onClick={handleSuggestTitle} disabled={isUpdating || isSuggesting} className="px-3 py-2 text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50">{isSuggesting ? 'サジェスト中...' : '✨ サジェスト'}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <h2 className="text-lg sm:text-xl font-semibold text-gray-800 flex-1">{videoInfo?.title}</h2>
                        <div className="flex items-center space-x-2">
                          <button onClick={() => { setIsEditing(true); setEditTitle(videoInfo?.title || ''); }} className="px-3 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50">🖊 編集</button>
                          <button onClick={() => setShowDeleteConfirm(true)} className="px-3 py-2 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">🗑 削除</button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="lg:col-span-1 px-4 sm:px-0">
            <VideoListSidebar currentVideoId={videoId} />
          </div>
        </div>
      </main>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3 text-center">
              <h3 className="text-lg font-medium text-gray-900">動画を削除</h3>
              <p className="text-sm text-gray-500 mt-2 px-7 py-3">この操作は取り消せません。本当に削除しますか？</p>
              <div className="flex space-x-3 px-4 py-3">
                <button onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting} className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 disabled:opacity-50">キャンセル</button>
                <button onClick={handleDelete} disabled={isDeleting} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">{isDeleting ? '削除中...' : '削除'}</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed top-4 right-4 z-50">
          <div className={`rounded-md p-4 shadow-lg ${toast.type === 'error' ? 'bg-red-100 border border-red-400 text-red-800' : 'bg-green-100 border border-green-400 text-green-800'}`}>
            <p className="text-sm font-medium">{toast.message}</p>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoPageInner() {
  const id = useSearchParams().get('id');
  if (!id) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-8 text-gray-600">動画が指定されていません。</main>
      </div>
    );
  }
  return <VideoDetail videoId={id} />;
}

export default function VideoPage() {
  return (
    <Suspense fallback={null}>
      <VideoPageInner />
    </Suspense>
  );
}
