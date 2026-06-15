import { useCallback, useRef, useState } from 'react';
import { parseHLSDuration } from './video-duration';

interface VideoLike {
  id: string;
  hlsUrl: string;
  status: 'converting' | 'ready' | 'failed';
}

/**
 * Tracks HLS durations for a list of videos.
 *
 * - Treats a video as "already fetched" if its id is a key in the map,
 *   even if the resolved duration is `null` (segments not ready yet,
 *   fetch failed, etc.). This avoids refetching the manifest on every
 *   render for videos whose duration can't be determined.
 * - `fetchDurations` has a stable identity (no dependency on the current
 *   `durations` state), so it's safe to use as an effect dependency
 *   without causing repeated effect re-runs.
 */
export function useVideoDurations() {
  const [durations, setDurations] = useState<Record<string, number | null>>({});
  const durationsRef = useRef<Record<string, number | null>>({});

  const fetchDurations = useCallback(async (videos: VideoLike[]) => {
    const readyVideos = videos.filter(v => v.status === 'ready');
    const newDurations: Record<string, number | null> = {};

    await Promise.all(
      readyVideos.map(async (video) => {
        if (!(video.id in durationsRef.current)) {
          const duration = await parseHLSDuration(video.hlsUrl);
          newDurations[video.id] = duration;
        }
      })
    );

    if (Object.keys(newDurations).length > 0) {
      durationsRef.current = { ...durationsRef.current, ...newDurations };
      setDurations(prev => ({ ...prev, ...newDurations }));
    }
  }, []);

  return { durations, fetchDurations };
}
