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
  status: 'converting' | 'ready' | 'failed';
  created_at?: string;
}

const STUCK_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

function elapsedText(createdAt: string): string {
  const elapsed = Date.now() - new Date(createdAt).getTime();
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 1) return '1分未満';
  if (minutes < 60) return `${minutes}分`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}時間`;
  return `${hours}時間${remainingMinutes}分`;
}

function ConvertingView({ videoInfo, onDelete }: { videoInfo: VideoInfo; onDelete: () => void }) {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [elapsed, setElapsed] = useState('');
  const [isStuck, setIsStuck] = useState(false);

  useEffect(() => {
    if (!videoInfo.created_at) return;
    const update = () => {
      const ms = Date.now() - new Date(videoInfo.created_at!).getTime();
      setElapsed(elapsedText(videoInfo.created_at!));
      setIsStuck(ms > STUCK_THRESHOLD_MS);
    };
    update();
    const interval = setInterval(update, 15_000);
    return () => clearInterval(interval);
  }, [videoInfo.created_at]);

  const handleDelete = async () => {
    setIsDeleting(true);
    try {
      const response = await apiFetch(`/api/videos/${videoInfo.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.message === 'ok') {
        onDelete();
      }
    } catch {
      // handled by caller
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  return (
    <div className="p-6">
      <div className="flex flex-col items-center text-center py-8">
        {isStuck ? (
          <>
            <div className="w-16 h-16 rounded-full bg-orange-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-orange-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-orange-800 mb-2">変換が固着している可能性があります</h3>
            <p className="text-sm text-gray-600 mb-1">
              経過時間: {elapsed}
            </p>
            <p className="text-sm text-gray-500 mb-6">
              変換開始から30分以上が経過しています。変換が正常に完了しない場合は、中断して削除できます。
            </p>
          </>
        ) : (
          <>
            <div className="w-16 h-16 rounded-full bg-blue-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-blue-600 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
            </div>
            <h3 className="text-lg font-semibold text-gray-800 mb-2">動画を変換中です</h3>
            {videoInfo.created_at && (
              <p className="text-sm text-gray-600 mb-1">
                経過時間: {elapsed}
              </p>
            )}
            <p className="text-sm text-gray-500 mb-6">
              変換が完了するまでしばらくお待ちください。このページは自動的に更新されます。
            </p>
          </>
        )}

        <button
          onClick={() => setShowDeleteConfirm(true)}
          className="px-4 py-2 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
        >
          変換を中断して削除
        </button>
      </div>

      <div className="p-4 border-t">
        <h2 className="text-lg font-semibold text-gray-800">{videoInfo.title}</h2>
      </div>

      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3 text-center">
              <h3 className="text-lg font-medium text-gray-900">変換を中断して削除</h3>
              <p className="text-sm text-gray-500 mt-2 px-7 py-3">
                {isStuck
                  ? 'この動画は固着している可能性があります。削除すると元に戻せません。'
                  : '変換中のジョブを中断し、動画を削除します。この操作は取り消せません。'}
              </p>
              <div className="flex space-x-3 px-4 py-3">
                <button onClick={() => setShowDeleteConfirm(false)} disabled={isDeleting} className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 disabled:opacity-50">キャンセル</button>
                <button onClick={handleDelete} disabled={isDeleting} className="flex-1 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50">{isDeleting ? '削除中...' : '中断して削除'}</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function VideoDetail({ videoId, playlistId }: { videoId: string; playlistId?: string }) {
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
    let cancelled = false;

    const fetchVideo = () => {
      apiFetch(`/api/videos/${videoId}`)
        .then((res) => {
          if (!res.ok) throw new Error('動画情報の取得に失敗しました');
          return res.json();
        })
        .then((data: VideoInfo) => {
          if (cancelled) return;
          setVideoInfo(data);
          setEditTitle(data.title);
          setLoading(false);

          if (data.status === 'converting') {
            setTimeout(() => {
              if (!cancelled) fetchVideo();
            }, 10_000);
          }
        })
        .catch((err) => {
          if (cancelled) return;
          setError(err.message);
          setLoading(false);
        });
    };

    setLoading(true);
    setError(null);
    fetchVideo();

    return () => { cancelled = true; };
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
        body: JSON.stringify({ fileName: videoInfo.title, videoId: videoInfo.id }),
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

  const isConverting = videoInfo?.status === 'converting';

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
              ) : isConverting ? (
                <ConvertingView videoInfo={videoInfo!} onDelete={() => router.push('/')} />
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
                          <button onClick={handleSuggestTitle} disabled={isUpdating || isSuggesting} className="px-3 py-2 text-sm font-medium rounded-md text-white bg-purple-600 hover:bg-purple-700 disabled:opacity-50">{isSuggesting ? 'サジェスト中...' : 'サジェスト'}</button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                        <h2 className="text-lg sm:text-xl font-semibold text-gray-800 flex-1">{videoInfo?.title}</h2>
                        <div className="flex items-center space-x-2">
                          <button onClick={() => { setIsEditing(true); setEditTitle(videoInfo?.title || ''); }} className="px-3 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50">編集</button>
                          <button onClick={() => setShowDeleteConfirm(true)} className="px-3 py-2 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700">削除</button>
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
          <div className="lg:col-span-1 px-4 sm:px-0">
            <VideoListSidebar currentVideoId={videoId} playlistId={playlistId} />
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
  const searchParams = useSearchParams();
  const id = searchParams.get('id');
  const playlist = searchParams.get('playlist');
  if (!id) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Header />
        <main className="max-w-7xl mx-auto px-4 py-8 text-gray-600">動画が指定されていません。</main>
      </div>
    );
  }
  return <VideoDetail videoId={id} playlistId={playlist ?? undefined} />;
}

export default function VideoPage() {
  return (
    <Suspense fallback={null}>
      <VideoPageInner />
    </Suspense>
  );
}
