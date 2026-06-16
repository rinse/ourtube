'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';
import Image from 'next/image';
import Header from '../components/Header';
import { apiFetch } from '../lib/api';

interface Playlist {
  id: string;
  name: string;
  videoCount: number;
  created_at: string;
  updated_at: string;
}

interface PlaylistListResponse {
  playlists: Playlist[];
  count: number;
}

interface PlaylistVideo {
  id: string;
  title: string;
  hlsUrl: string;
  status: 'converting' | 'ready' | 'failed';
  thumbnailUrl?: string | null;
}

interface PlaylistDetailResponse {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
  videos: PlaylistVideo[];
}

interface Video {
  id: string;
  title: string;
  hlsUrl: string;
  status: 'converting' | 'ready' | 'failed';
  thumbnailUrl?: string | null;
}

interface VideoListResponse {
  videos: Video[];
  count: number;
}

type Toast = { message: string; type: 'error' | 'success' };

function PlaylistList() {
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [newName, setNewName] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Playlist | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);

  const fetchPlaylists = () => {
    setLoading(true);
    setError(null);
    apiFetch('/api/playlists')
      .then((res) => {
        if (!res.ok) throw new Error('プレイリストの取得に失敗しました');
        return res.json();
      })
      .then((data: PlaylistListResponse) => {
        setPlaylists(data.playlists);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchPlaylists();
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleCreate = async () => {
    if (!newName.trim()) return;
    setIsCreating(true);
    try {
      const response = await apiFetch('/api/playlists', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim() }),
      });
      if (response.ok) {
        setNewName('');
        fetchPlaylists();
      } else {
        setToast({ message: '作成に失敗しました', type: 'error' });
      }
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
    } finally {
      setIsCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      const response = await apiFetch(`/api/playlists/${deleteTarget.id}`, { method: 'DELETE' });
      const data = await response.json();
      if (data.message === 'ok') {
        setPlaylists((prev) => prev.filter((p) => p.id !== deleteTarget.id));
        setDeleteTarget(null);
      } else {
        setToast({ message: '削除に失敗しました', type: 'error' });
      }
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100">
      <Header />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <h1 className="text-xl font-semibold text-gray-800 mb-6">プレイリスト</h1>

        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          <h2 className="text-sm font-medium text-gray-700 mb-2">新規作成</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleCreate();
              }}
              placeholder="プレイリスト名"
              className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              disabled={isCreating}
            />
            <button
              onClick={handleCreate}
              disabled={isCreating || !newName.trim()}
              className="px-4 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50"
            >
              {isCreating ? '作成中...' : '作成'}
            </button>
          </div>
        </div>

        {loading ? (
          <div className="space-y-3">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="bg-white rounded-lg shadow-sm p-4 animate-pulse">
                <div className="h-5 bg-gray-200 rounded w-1/3 mb-2"></div>
                <div className="h-4 bg-gray-200 rounded w-1/4"></div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="bg-white rounded-lg shadow-sm p-4 text-red-600 text-sm">{error}</div>
        ) : playlists.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-4 text-gray-500 text-sm text-center">
            プレイリストはありません
          </div>
        ) : (
          <div className="space-y-3">
            {playlists.map((playlist) => (
              <div key={playlist.id} className="bg-white rounded-lg shadow-sm p-4 flex items-center justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <Link href={`/playlists?id=${playlist.id}`} className="text-base font-semibold text-gray-800 hover:text-blue-600 transition-colors">
                    {playlist.name}
                  </Link>
                  <p className="text-xs text-gray-500 mt-1">{playlist.videoCount} 件の動画</p>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    href={`/playlists?id=${playlist.id}`}
                    className="px-3 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50"
                  >
                    管理
                  </Link>
                  <button
                    onClick={() => setDeleteTarget(playlist)}
                    className="px-3 py-2 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700"
                  >
                    削除
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {deleteTarget && (
        <div className="fixed inset-0 bg-gray-600 bg-opacity-50 overflow-y-auto h-full w-full z-50">
          <div className="relative top-20 mx-auto p-5 border w-96 shadow-lg rounded-md bg-white">
            <div className="mt-3 text-center">
              <h3 className="text-lg font-medium text-gray-900">プレイリストを削除</h3>
              <p className="text-sm text-gray-500 mt-2 px-7 py-3">
                「{deleteTarget.name}」を削除します。この操作は取り消せません。
              </p>
              <div className="flex space-x-3 px-4 py-3">
                <button onClick={() => setDeleteTarget(null)} disabled={isDeleting} className="flex-1 px-4 py-2 bg-gray-300 text-gray-700 rounded-md hover:bg-gray-400 disabled:opacity-50">キャンセル</button>
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

function PlaylistDetail({ playlistId }: { playlistId: string }) {
  const [playlist, setPlaylist] = useState<PlaylistDetailResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [isUpdating, setIsUpdating] = useState(false);
  const [allVideos, setAllVideos] = useState<Video[]>([]);
  const [toast, setToast] = useState<Toast | null>(null);
  const [busyVideoId, setBusyVideoId] = useState<string | null>(null);

  const fetchPlaylist = (showSpinner = true) => {
    if (showSpinner) setLoading(true);
    setError(null);
    apiFetch(`/api/playlists/${playlistId}`)
      .then((res) => {
        if (!res.ok) throw new Error('プレイリストの取得に失敗しました');
        return res.json();
      })
      .then((data: PlaylistDetailResponse) => {
        setPlaylist(data);
        setEditName(data.name);
        setLoading(false);
      })
      .catch((err) => {
        setError(err.message);
        setLoading(false);
      });
  };

  const fetchAllVideos = () => {
    apiFetch('/api/videos')
      .then((res) => {
        if (!res.ok) throw new Error('動画一覧の取得に失敗しました');
        return res.json();
      })
      .then((data: VideoListResponse) => {
        setAllVideos(data.videos);
      })
      .catch(() => {
        // Non-fatal: "add videos" section will just be empty.
      });
  };

  useEffect(() => {
    fetchPlaylist();
    fetchAllVideos();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playlistId]);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 5000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleRenameConfirm = async () => {
    if (!editName.trim()) return;
    setIsUpdating(true);
    try {
      const response = await apiFetch(`/api/playlists/${playlistId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const data = await response.json();
      if (data.message === 'ok') {
        setPlaylist((prev) => (prev ? { ...prev, name: editName.trim() } : null));
        setIsEditing(false);
        setToast({ message: '名前を変更しました', type: 'success' });
      } else {
        setToast({ message: '更新に失敗しました', type: 'error' });
        setEditName(playlist?.name || '');
      }
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
      setEditName(playlist?.name || '');
    } finally {
      setIsUpdating(false);
    }
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    if (!playlist) return;
    const targetIndex = index + direction;
    if (targetIndex < 0 || targetIndex >= playlist.videos.length) return;

    const reordered = [...playlist.videos];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);
    const videoIds = reordered.map((v) => v.id);

    setBusyVideoId(moved.id);
    try {
      const response = await apiFetch(`/api/playlists/${playlistId}/videos`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoIds }),
      });
      const data = await response.json();
      if (data.message === 'ok') {
        fetchPlaylist(false);
      } else {
        setToast({ message: '並び替えに失敗しました', type: 'error' });
      }
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
    } finally {
      setBusyVideoId(null);
    }
  };

  const handleRemove = async (videoId: string) => {
    setBusyVideoId(videoId);
    try {
      const response = await apiFetch(`/api/playlists/${playlistId}/videos/${videoId}`, {
        method: 'DELETE',
      });
      const data = await response.json();
      if (data.message === 'ok') {
        fetchPlaylist(false);
        fetchAllVideos();
      } else {
        setToast({ message: '削除に失敗しました', type: 'error' });
      }
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
    } finally {
      setBusyVideoId(null);
    }
  };

  const handleAdd = async (videoId: string) => {
    setBusyVideoId(videoId);
    try {
      const response = await apiFetch(`/api/playlists/${playlistId}/videos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ videoId }),
      });
      const data = await response.json();
      if (data.message === 'ok') {
        fetchPlaylist(false);
        fetchAllVideos();
      } else {
        setToast({ message: '追加に失敗しました', type: 'error' });
      }
    } catch {
      setToast({ message: 'ネットワークエラーが発生しました', type: 'error' });
    } finally {
      setBusyVideoId(null);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Header />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <div className="animate-pulse">
            <div className="h-6 bg-gray-200 rounded w-1/3 mb-4"></div>
            <div className="h-4 bg-gray-200 rounded w-1/4"></div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !playlist) {
    return (
      <div className="min-h-screen bg-gray-100">
        <Header />
        <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <p className="text-red-600 text-sm">{error || 'プレイリストが見つかりません'}</p>
          <Link href="/playlists" className="text-blue-600 hover:underline text-sm mt-4 inline-block">
            ← プレイリスト一覧へ戻る
          </Link>
        </main>
      </div>
    );
  }

  const playlistVideoIds = new Set(playlist.videos.map((v) => v.id));
  const addableVideos = allVideos.filter((v) => !playlistVideoIds.has(v.id));

  return (
    <div className="min-h-screen bg-gray-100">
      <Header />
      <main className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Link href="/playlists" className="text-blue-600 hover:underline text-sm mb-4 inline-block">
          ← プレイリスト一覧へ戻る
        </Link>

        <div className="bg-white rounded-lg shadow-sm p-4 mb-6">
          {isEditing ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-2">
              <input
                type="text"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full sm:flex-1 px-3 py-2 border border-gray-300 rounded-md text-base sm:text-lg font-semibold"
                disabled={isUpdating}
              />
              <div className="flex items-center space-x-2">
                <button onClick={handleRenameConfirm} disabled={isUpdating || !editName.trim()} className="px-3 py-2 text-sm font-medium rounded-md text-white bg-green-600 hover:bg-green-700 disabled:opacity-50">{isUpdating ? '保存中...' : '確定'}</button>
                <button onClick={() => { setIsEditing(false); setEditName(playlist.name); }} disabled={isUpdating} className="px-3 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50">キャンセル</button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <h1 className="text-lg sm:text-xl font-semibold text-gray-800 flex-1">{playlist.name}</h1>
              <button onClick={() => { setIsEditing(true); setEditName(playlist.name); }} className="px-3 py-2 text-sm font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 self-start sm:self-auto">
                名前を変更
              </button>
            </div>
          )}
        </div>

        <h2 className="text-sm font-medium text-gray-700 mb-2">動画一覧</h2>
        {playlist.videos.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-4 text-gray-500 text-sm text-center mb-6">
            動画はまだ追加されていません
          </div>
        ) : (
          <div className="space-y-3 mb-6">
            {playlist.videos.map((video, index) => {
              const isReady = video.status === 'ready';
              const media = (
                <>
                  <div className="w-24 sm:w-32 aspect-video relative bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 rounded shrink-0">
                    {video.thumbnailUrl ? (
                      <Image
                        src={video.thumbnailUrl}
                        alt={video.title}
                        className="object-cover rounded"
                        fill
                        sizes="128px"
                        onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                          e.currentTarget.style.display = 'none';
                          e.currentTarget.nextElementSibling?.classList.remove('hidden');
                        }}
                      />
                    ) : null}
                    <div className={`absolute inset-0 flex items-center justify-center ${video.thumbnailUrl ? 'hidden' : ''}`}>
                      <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                      </svg>
                    </div>
                  </div>
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-gray-800 line-clamp-2 leading-tight">{video.title}</h3>
                    <div className={`text-xs mt-1 ${
                      video.status === 'ready' ? 'text-green-600' : video.status === 'converting' ? 'text-yellow-600' : 'text-red-600'
                    }`}>
                      {video.status === 'ready' ? 'Ready' : video.status === 'converting' ? 'Converting' : 'Failed'}
                    </div>
                  </div>
                </>
              );

              return (
              <div key={video.id} className="bg-white rounded-lg shadow-sm overflow-hidden flex items-center gap-3 p-3">
                {isReady ? (
                  <Link
                    href={`/videos?id=${video.id}&playlist=${playlistId}`}
                    className="flex items-center gap-3 flex-1 min-w-0 hover:opacity-80 transition-opacity"
                  >
                    {media}
                  </Link>
                ) : (
                  <div className="flex items-center gap-3 flex-1 min-w-0">
                    {media}
                  </div>
                )}
                <div className="flex flex-col items-center gap-1 shrink-0">
                  <button
                    onClick={() => handleMove(index, -1)}
                    disabled={index === 0 || busyVideoId !== null}
                    className="px-2 py-1 text-xs font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="上へ"
                  >
                    ▲
                  </button>
                  <button
                    onClick={() => handleMove(index, 1)}
                    disabled={index === playlist.videos.length - 1 || busyVideoId !== null}
                    className="px-2 py-1 text-xs font-medium rounded-md text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 disabled:opacity-50 disabled:cursor-not-allowed"
                    aria-label="下へ"
                  >
                    ▼
                  </button>
                </div>
                <button
                  onClick={() => handleRemove(video.id)}
                  disabled={busyVideoId !== null}
                  className="px-3 py-2 text-sm font-medium rounded-md text-white bg-red-600 hover:bg-red-700 disabled:opacity-50 shrink-0"
                >
                  削除
                </button>
              </div>
              );
            })}
          </div>
        )}

        <h2 className="text-sm font-medium text-gray-700 mb-2">動画を追加</h2>
        {addableVideos.length === 0 ? (
          <div className="bg-white rounded-lg shadow-sm p-4 text-gray-500 text-sm text-center">
            追加できる動画はありません
          </div>
        ) : (
          <div className="space-y-3">
            {addableVideos.map((video) => (
              <div key={video.id} className="bg-white rounded-lg shadow-sm overflow-hidden flex items-center gap-3 p-3">
                <div className="w-24 sm:w-32 aspect-video relative bg-gradient-to-br from-gray-200 via-gray-300 to-gray-400 rounded shrink-0">
                  {video.thumbnailUrl ? (
                    <Image
                      src={video.thumbnailUrl}
                      alt={video.title}
                      className="object-cover rounded"
                      fill
                      sizes="128px"
                      onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                        e.currentTarget.style.display = 'none';
                        e.currentTarget.nextElementSibling?.classList.remove('hidden');
                      }}
                    />
                  ) : null}
                  <div className={`absolute inset-0 flex items-center justify-center ${video.thumbnailUrl ? 'hidden' : ''}`}>
                    <svg className="w-6 h-6 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-gray-800 line-clamp-2 leading-tight">{video.title}</h3>
                  <div className={`text-xs mt-1 ${
                    video.status === 'ready' ? 'text-green-600' : video.status === 'converting' ? 'text-yellow-600' : 'text-red-600'
                  }`}>
                    {video.status === 'ready' ? 'Ready' : video.status === 'converting' ? 'Converting' : 'Failed'}
                  </div>
                </div>
                <button
                  onClick={() => handleAdd(video.id)}
                  disabled={busyVideoId !== null}
                  className="px-3 py-2 text-sm font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 disabled:opacity-50 shrink-0"
                >
                  追加
                </button>
              </div>
            ))}
          </div>
        )}
      </main>

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

function PlaylistsPageInner() {
  const id = useSearchParams().get('id');
  if (id) {
    return <PlaylistDetail playlistId={id} />;
  }
  return <PlaylistList />;
}

export default function PlaylistsPage() {
  return (
    <Suspense fallback={null}>
      <PlaylistsPageInner />
    </Suspense>
  );
}
