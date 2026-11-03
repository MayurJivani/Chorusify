import { memo, useEffect, useRef, useState } from 'react';

/** Beyond this the position is corrected. Below it, a seek would be more audible than the drift. */
const DRIFT_LIMIT_SECONDS = 0.25;

interface SyncedAudioProps {
  previewUrl: string;
  /** When the song starts, on this device's clock. */
  playAt: number;
  playbackSeconds: number;
  paused?: boolean;
  stopped?: boolean;
  /** Reported once if the audio cannot be loaded, so the screen can say so. */
  onFailed?: () => void;
  /** 0 to 1. */
  volume?: number;
}

/**
 * Plays one clip at a scheduled instant, so a room of phones starts together.
 *
 * Works from the clock rather than from events: the position it should be at is always
 * `now - playAt`, so arriving late (a slow network, a reconnect, a late join) needs no special case.
 * Memoised and self-contained, because an unrelated re-render must never touch the audio.
 */
export const SyncedAudio = memo(function SyncedAudio({
  previewUrl,
  playAt,
  playbackSeconds,
  paused = false,
  stopped = false,
  onFailed,
  volume = 1,
}: SyncedAudioProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [blocked, setBlocked] = useState(false);
  const failed = useRef(onFailed);
  failed.current = onFailed;

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (paused || stopped) {
      audio.pause();
      return;
    }

    const tick = () => {
      const position = (Date.now() - playAt) / 1000;
      if (position < 0) return;
      if (position >= playbackSeconds) {
        audio.pause();
        return;
      }
      if (audio.paused) {
        audio.currentTime = position;
        audio.play().then(
          () => setBlocked(false),
          (err: DOMException) => {
            if (err.name === 'NotAllowedError') setBlocked(true);
          },
        );
      } else if (Math.abs(audio.currentTime - position) > DRIFT_LIMIT_SECONDS) {
        audio.currentTime = position;
      }
    };
    tick();
    const interval = setInterval(tick, 200);
    return () => clearInterval(interval);
  }, [playAt, playbackSeconds, paused, stopped, previewUrl]);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      audio?.pause();
    };
  }, []);

  return (
    <>
      <audio ref={audioRef} src={previewUrl} preload="auto" onError={() => failed.current?.()} />
      {blocked && (
        <button
          type="button"
          className="btn-primary w-full !rounded-xl"
          onClick={() => {
            // Inside a real tap, which is what the browser was waiting for.
            audioRef.current?.play().then(
              () => setBlocked(false),
              () => undefined,
            );
          }}
        >
          Tap to turn the sound on
        </button>
      )}
    </>
  );
});
