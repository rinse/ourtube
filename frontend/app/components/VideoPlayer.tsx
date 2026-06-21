'use client';

import { useEffect, useRef, useState } from 'react';
import Hls from 'hls.js';

interface VideoPlayerProps {
  src: string;
  poster?: string;
  autoPlay?: boolean;
}

const MAX_NETWORK_RETRIES = 3;
const MAX_MEDIA_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 1000;

export default function VideoPlayer({ src, poster, autoPlay = true }: VideoPlayerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<Hls | null>(null);
  const networkRetryCountRef = useRef(0);
  const mediaRetryCountRef = useRef(0);
  const retryTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retriesExhausted, setRetriesExhausted] = useState(false);
  const [retryToken, setRetryToken] = useState(0);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const clearRetryTimeout = () => {
      if (retryTimeoutRef.current) {
        clearTimeout(retryTimeoutRef.current);
        retryTimeoutRef.current = null;
      }
    };

    const setupVideo = () => {
      if (Hls.isSupported()) {
        const hls = new Hls({
          debug: false,
          enableWorker: true,
          lowLatencyMode: false,
        });

        hlsRef.current = hls;

        hls.on(Hls.Events.ERROR, (event, data) => {
          if (data.fatal) {
            switch (data.type) {
              case Hls.ErrorTypes.NETWORK_ERROR:
                if (networkRetryCountRef.current < MAX_NETWORK_RETRIES) {
                  const attempt = networkRetryCountRef.current + 1;
                  networkRetryCountRef.current = attempt;
                  setError('Network error occurred');
                  const delay = RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
                  clearRetryTimeout();
                  retryTimeoutRef.current = setTimeout(() => {
                    retryTimeoutRef.current = null;
                    hls.startLoad();
                  }, delay);
                } else {
                  setError('Network error occurred');
                  setRetriesExhausted(true);
                }
                break;
              case Hls.ErrorTypes.MEDIA_ERROR:
                if (mediaRetryCountRef.current < MAX_MEDIA_RETRIES) {
                  mediaRetryCountRef.current += 1;
                  setError('Media error occurred');
                  hls.recoverMediaError();
                } else {
                  setError('Media error occurred');
                  setRetriesExhausted(true);
                }
                break;
              default:
                setError('An error occurred during playback');
                setRetriesExhausted(true);
                hls.destroy();
                break;
            }
          }
        });

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          setError(null);
          networkRetryCountRef.current = 0;
          mediaRetryCountRef.current = 0;
          // Auto-play if enabled
          if (autoPlay) {
            video.play().catch((err) => {
              console.log('Auto-play failed:', err);
              // Auto-play might fail due to browser policies, which is fine
            });
          }
        });

        hls.on(Hls.Events.FRAG_LOADED, () => {
          networkRetryCountRef.current = 0;
        });

        hls.loadSource(src);
        hls.attachMedia(video);
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src;
        // Auto-play if enabled (for native HLS support)
        if (autoPlay) {
          video.addEventListener('loadedmetadata', () => {
            video.play().catch((err) => {
              console.log('Auto-play failed:', err);
              // Auto-play might fail due to browser policies, which is fine
            });
          });
        }
      } else {
        setError('HLS is not supported in this browser');
      }
    };

    setupVideo();

    return () => {
      clearRetryTimeout();
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
    };
  }, [src, autoPlay, retryToken]);

  const handleRetry = () => {
    networkRetryCountRef.current = 0;
    mediaRetryCountRef.current = 0;
    setRetriesExhausted(false);
    setError(null);
    setRetryToken((token) => token + 1);
  };

  const handleFullscreenToggle = async () => {
    const video = videoRef.current;
    if (!video) return;

    try {
      if (!document.fullscreenElement) {
        await video.requestFullscreen();
        if (screen.orientation && 'lock' in screen.orientation) {
          try {
            await (screen.orientation as { lock: (orientation: string) => Promise<void> }).lock('landscape');
          } catch (e) {
            console.log('Screen orientation lock failed:', e);
          }
        }
        setIsFullscreen(true);
      } else {
        await document.exitFullscreen();
        if (screen.orientation && 'unlock' in screen.orientation) {
          try {
            (screen.orientation as { unlock: () => void }).unlock();
          } catch (e) {
            console.log('Screen orientation unlock failed:', e);
          }
        }
        setIsFullscreen(false);
      }
    } catch (err) {
      console.error('Fullscreen error:', err);
    }
  };

  const handleClick = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused) {
      video.play().catch((err) => {
        console.log('Play failed:', err);
      });
    } else {
      video.pause();
    }
  };

  const handleDoubleClick = () => {
    handleFullscreenToggle();
  };

  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
    };
  }, []);

  return (
    <div className="relative w-full bg-black">
      <div className="relative aspect-video">
        <video
          ref={videoRef}
          className="w-full h-full"
          poster={poster}
          controls
          playsInline
          autoPlay={autoPlay}
        />
        {/* Invisible overlay to capture clicks */}
        <div 
          className="absolute inset-0 z-10"
          onClick={handleClick}
          onDoubleClick={handleDoubleClick}
          style={{ 
            // Make the overlay invisible but still capture clicks
            background: 'transparent',
            // Don't capture clicks on the bottom 48px where controls are
            clipPath: 'inset(0 0 48px 0)'
          }}
        />
        {error && (
          <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 z-20">
            <div className="text-white text-center p-4">
              <p className="text-lg font-semibold mb-2">Error</p>
              <p>{error}</p>
              {retriesExhausted && (
                <button
                  onClick={handleRetry}
                  className="mt-4 px-4 py-2 bg-white bg-opacity-20 rounded-lg hover:bg-opacity-30 transition-opacity"
                >
                  再試行
                </button>
              )}
            </div>
          </div>
        )}
        <button
          onClick={handleFullscreenToggle}
          className="absolute bottom-4 right-4 bg-black bg-opacity-50 text-white p-2 rounded-lg hover:bg-opacity-75 transition-opacity z-20"
          aria-label={isFullscreen ? 'Exit fullscreen' : 'Enter fullscreen'}
        >
          {isFullscreen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 9V4.5M9 9H4.5M9 9L3.75 3.75M9 15v4.5M9 15H4.5M9 15l-5.25 5.25M15 9h4.5M15 9V4.5M15 9l5.25-5.25M15 15h4.5M15 15v4.5m0-4.5l5.25 5.25" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-5h-4m4 0v4m0-4l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}