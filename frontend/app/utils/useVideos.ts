import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';

export interface Video {
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

const BASE_POLL_DELAY_MS = 5000;
const MAX_POLL_DELAY_MS = 30000;
const BACKOFF_FACTOR = 2;

/**
 * Fetches the video list (or a single playlist's videos) and, while at least
 * one video is `converting`, keeps polling with exponential backoff
 * (starting at `BASE_POLL_DELAY_MS`, doubling up to `MAX_POLL_DELAY_MS`).
 *
 * The backoff resets to the base delay whenever the set of converting video
 * ids changes (e.g. one finishes while another is still converting), and
 * polling stops entirely once nothing is converting.
 *
 * When `playlistId` is provided, this fetches that playlist's videos once
 * and does not poll (playlists are not subject to conversion).
 */
export function useVideos(playlistId?: string) {
  const [videos, setVideos] = useState<Video[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Duration comes from the API response (computed at conversion-finalize
  // time and stored in metadata) rather than fetched per-video from the
  // manifest, so opening the list never bursts per-video requests.
  const durations = useMemo(
    () => Object.fromEntries(videos.map(v => [v.id, v.duration ?? null])),
    [videos],
  );

  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const delayRef = useRef(BASE_POLL_DELAY_MS);
  const convertingKeyRef = useRef<string>('');
  const videosRef = useRef<Video[]>([]);

  const removeVideo = useCallback((id: string) => {
    videosRef.current = videosRef.current.filter(v => v.id !== id);
    setVideos(videosRef.current);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    delayRef.current = BASE_POLL_DELAY_MS;
    convertingKeyRef.current = '';
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }

    let cancelled = false;

    if (playlistId) {
      apiFetch(`/api/playlists/${playlistId}`)
        .then(res => {
          if (!res.ok) {
            throw new Error('Failed to fetch playlist');
          }
          return res.json();
        })
        .then((data: PlaylistDetailResponse) => {
          if (cancelled) return;
          videosRef.current = data.videos;
          setVideos(data.videos);
          setLoading(false);
        })
        .catch(err => {
          if (cancelled) return;
          setError(err.message);
          setLoading(false);
        });

      return () => {
        cancelled = true;
      };
    }

    const fetchVideos = () => {
      apiFetch('/api/videos')
        .then(res => {
          if (!res.ok) {
            throw new Error('Failed to fetch videos');
          }
          return res.json();
        })
        .then((data: VideoListResponse) => {
          if (cancelled) return;

          videosRef.current = data.videos;
          setVideos(data.videos);
          setLoading(false);

          const convertingIds = data.videos
            .filter(v => v.status === 'converting')
            .map(v => v.id)
            .sort();
          const convertingKey = convertingIds.join(',');

          if (convertingIds.length === 0) {
            // Nothing converting: stop polling.
            convertingKeyRef.current = '';
            delayRef.current = BASE_POLL_DELAY_MS;
            return;
          }

          if (convertingKey !== convertingKeyRef.current) {
            // Conversion state changed: reset backoff.
            delayRef.current = BASE_POLL_DELAY_MS;
          } else {
            delayRef.current = Math.min(delayRef.current * BACKOFF_FACTOR, MAX_POLL_DELAY_MS);
          }
          convertingKeyRef.current = convertingKey;

          timeoutRef.current = setTimeout(fetchVideos, delayRef.current);
        })
        .catch(err => {
          if (cancelled) return;
          setError(err.message);
          setLoading(false);
        });
    };

    // Initial fetch
    fetchVideos();

    return () => {
      cancelled = true;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, [playlistId]);

  return { videos, loading, error, durations, removeVideo };
}
