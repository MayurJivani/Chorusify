import { useEffect, useRef, useState } from 'react';
import { Cassette } from './Cassette';
import { Disc } from './Disc';
import { Tonearm } from './Tonearm';
import { snippetPlayback } from './ridges';

let mediaUnlocked = false;

export function ensureMediaUnlocked(): void {
  unlockMedia();
}

function deterministicRandom(seed: string): number {
  let h = 0;
  for (let i = 0; i < seed.length; i++) {
    h = (Math.imul(31, h) + seed.charCodeAt(i)) | 0;
  }
  return ((h >>> 0) % 10000) / 10000;
}

function unlockMedia() {
  if (mediaUnlocked) return;
  try {
    const ctx = new AudioContext();
    const buf = ctx.createBuffer(1, 1, 22050);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.start(0);
    src.stop(0.001);
    void ctx.close();
    mediaUnlocked = true;
  } catch {
    // AudioContext unavailable — playback will still work on user tap
  }
  document.removeEventListener('click', unlockMedia, true);
  document.removeEventListener('touchstart', unlockMedia, true);
  document.removeEventListener('keydown', unlockMedia, true);
}

document.addEventListener('click', unlockMedia, true);
document.addEventListener('touchstart', unlockMedia, true);
document.addEventListener('keydown', unlockMedia, true);

interface SnippetPlayerProps {
  previewUrl: string;
  stageSeconds: number;
  disabled?: boolean;
  artistPictureUrl?: string | null;
  onSnippetEnd?: () => void;
  /** When true the snippet auto-plays (e.g. after a skip in choice mode). */
  autoPlay?: boolean;
  /** A changing value that triggers a (re)play — used by multiplayer rounds, where each
   *  player reveals more of their own snippet on demand and the new length replays. */
  playSignal?: number;
  /** When set, the snippet always starts at this offset instead of a random one, so all
   *  players hear the same slice of the clip (used for fair multiplayer rounds). */
  fixedOffsetSeconds?: number;
  /** Desi Daily plays from a cassette, labelled with this. Everything else gets the record. */
  cassetteLabel?: string;
  /** Multiplayer's header already counts the round down; a second clock here would compete. */
  hideClock?: boolean;
}

/** Plays a snippet of the Deezer preview clip (from a fixed offset when provided,
 *  otherwise a random offset with enough headroom for the full 16s snippet), for exactly
 *  `stageSeconds`, with a rotating vinyl record visual. The offset is picked once per play
 *  and stays consistent across stages within the same round so the player always hears the
 *  same slice. */
export function SnippetPlayer({
  previewUrl,
  stageSeconds,
  disabled,
  artistPictureUrl,
  onSnippetEnd,
  autoPlay,
  playSignal,
  fixedOffsetSeconds,
  cassetteLabel,
  hideClock = false,
}: SnippetPlayerProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const stopTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const seekOffsetRef = useRef<number>(0);
  /** Audio position at which the current play must stop; null when not playing. */
  const playUntilRef = useRef<number | null>(null);
  /** Wall-clock time when playback started, for the countdown display. */
  const playStartedAtRef = useRef<number>(0);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** Tracks intent to play so a `canplay` listener can retry after the source loads. */
  const wantPlayRef = useRef(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [timeLeft, setTimeLeft] = useState<number | null>(null);
  const [progress, setProgress] = useState(0);
  /** The browser refused to start playback without a gesture. */
  const [blocked, setBlocked] = useState(false);
  const [volume, setVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('snippet-volume');
      if (saved !== null) {
        const parsed = parseFloat(saved);
        if (!isNaN(parsed)) return parsed;
      }
    } catch {
      /* localStorage unavailable */
    }
    return 0.5;
  });

  useEffect(() => {
    snippetPlayback.playing = isPlaying;
    return () => {
      snippetPlayback.playing = false;
    };
  }, [isPlaying]);

  // Sync volume to audio element and persist to localStorage
  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
    try {
      localStorage.setItem('snippet-volume', String(volume));
    } catch {
      /* localStorage unavailable */
    }
  }, [volume]);

  useEffect(() => {
    const audio = audioRef.current;
    return () => {
      if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
      // Pause on the way out as well as clearing the timer. Clearing alone left a playing
      // element with nothing scheduled to stop it, so it ran to the end of the clip — which
      // in multiplayer meant a player heard the whole song instead of their one-second slice.
      audio?.pause();
    };
  }, []);

  // Retry play when the audio source finishes loading, if a play attempt was pending.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onCanPlay = () => {
      if (wantPlayRef.current && audio.paused) {
        forcePlay();
      }
    };
    audio.addEventListener('canplay', onCanPlay);
    return () => audio.removeEventListener('canplay', onCanPlay);
  }, [previewUrl]);

  // Pick the offset once per previewUrl change (i.e. per round). With fixedOffsetSeconds
  // set, everyone hears the same slice; otherwise a random offset is picked.
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const pickOffset = () => {
      const duration = audio.duration;
      if (fixedOffsetSeconds != null) {
        seekOffsetRef.current =
          isFinite(duration) && duration > 0
            ? Math.min(fixedOffsetSeconds, Math.max(0, duration - 1))
            : fixedOffsetSeconds;
      } else if (isFinite(duration) && duration > 16) {
        seekOffsetRef.current = deterministicRandom(previewUrl) * (duration - 16);
      } else {
        seekOffsetRef.current = 0;
      }
    };

    // If metadata is already loaded, pick now; otherwise wait.
    if (audio.readyState >= 1) {
      pickOffset();
    } else {
      audio.addEventListener('loadedmetadata', pickOffset, { once: true });
      return () => audio.removeEventListener('loadedmetadata', pickOffset);
    }
  }, [previewUrl, fixedOffsetSeconds]);

  const stageSecondsRef = useRef(stageSeconds);
  stageSecondsRef.current = stageSeconds;

  const forcePlay = () => {
    const audio = audioRef.current;
    if (!audio || disabled) return;

    if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);

    const secs = stageSecondsRef.current;
    const startAt = seekOffsetRef.current;
    audio.currentTime = startAt;
    playUntilRef.current = startAt + secs;
    wantPlayRef.current = true;

    setBlocked(false);
    void audio
      .play()
      .then(() => {
        setIsPlaying(true);
        playStartedAtRef.current = Date.now();
        if (stopTimeoutRef.current) clearTimeout(stopTimeoutRef.current);
        stopTimeoutRef.current = setTimeout(() => stopPlayback(true), secs * 1000);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'NotAllowedError') {
          setIsPlaying(false);
          setBlocked(true);
          wantPlayRef.current = false;
        }
      });
  };

  // Auto-play when the autoPlay prop becomes true (e.g. after a skip in choice mode).
  const prevAutoPlayRef = useRef(autoPlay);
  useEffect(() => {
    if (autoPlay && !prevAutoPlayRef.current && !disabled) {
      forcePlay();
    }
    prevAutoPlayRef.current = autoPlay;
  }, [autoPlay, disabled]);

  // Auto-play whenever a player reveals a new snippet stage (multiplayer). Each change
  // in playSignal triggers exactly one play; disabled blocks it (e.g. during the reveal).
  const lastPlaySignalRef = useRef<number | null>(null);
  useEffect(() => {
    if (playSignal == null) return;
    if (playSignal !== lastPlaySignalRef.current) {
      lastPlaySignalRef.current = playSignal;
      if (!disabled) forcePlay();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playSignal, disabled]);

  const handlePlayPause = () => {
    if (isPlaying) {
      stopPlayback();
    } else {
      forcePlay();
    }
  };

  useEffect(() => {
    if (isPlaying) {
      const tick = () => {
        const elapsed = (Date.now() - playStartedAtRef.current) / 1000;
        const remaining = Math.max(0, Math.ceil(stageSeconds - elapsed));
        setTimeLeft(remaining);
        // From the audio clock, not the wall clock: the arm must not move if the audio stalls.
        const audio = audioRef.current;
        if (audio)
          setProgress(Math.min(1, (audio.currentTime - seekOffsetRef.current) / stageSeconds));
      };
      tick();
      countdownRef.current = setInterval(tick, 200);
      return () => {
        if (countdownRef.current) clearInterval(countdownRef.current);
      };
    } else {
      setTimeLeft(null);
      setProgress(0);
      if (countdownRef.current) {
        clearInterval(countdownRef.current);
        countdownRef.current = null;
      }
    }
  }, [isPlaying, stageSeconds]);

  const stopPlayback = (natural = false) => {
    const audio = audioRef.current;
    if (stopTimeoutRef.current) {
      clearTimeout(stopTimeoutRef.current);
      stopTimeoutRef.current = null;
    }
    playUntilRef.current = null;
    wantPlayRef.current = false;
    audio?.pause();
    setIsPlaying(false);
    if (natural) onSnippetEnd?.();
  };

  /** Backstop for the timer: whatever happens to the scheduled stop, playback can never run
   *  past the stage's slice of the clip. */
  const handleTimeUpdate = () => {
    const audio = audioRef.current;
    const limit = playUntilRef.current;
    if (!audio || limit == null) return;
    if (audio.currentTime >= limit) stopPlayback(true);
  };

  return (
    <div className="flex flex-col items-center gap-6">
      <audio
        ref={audioRef}
        src={previewUrl}
        preload="auto"
        onTimeUpdate={handleTimeUpdate}
        onEnded={() => setIsPlaying(false)}
      />

      {cassetteLabel ? (
        <Cassette
          playing={isPlaying}
          progress={progress}
          label={cassetteLabel}
          disabled={disabled}
          onToggle={handlePlayPause}
        />
      ) : (
        /* Vinyl Record Player Container */
        <div className="relative">
          <Tonearm
            playing={isPlaying}
            progress={progress}
            disabled={disabled}
            onToggle={handlePlayPause}
          />
          {isPlaying && (
            <span
              className="absolute inset-0 rounded-full pointer-events-none scale-110 animate-pulse"
              style={{
                boxShadow: '0 0 30px rgba(139, 92, 246, 0.5), 0 0 60px rgba(139, 92, 246, 0.25)',
              }}
            />
          )}
          {/* Stepped down on small screens: at 192px the record plus the transport, pips, input
              and guess list overflowed a 375x812 viewport and cut off the Skip button. */}
          <button
            type="button"
            onClick={handlePlayPause}
            disabled={disabled}
            aria-label={isPlaying ? 'Stop the snippet' : 'Play the snippet'}
            className="block h-32 w-32 rounded-full transition-transform duration-300 hover:scale-[1.03] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-40 sm:h-48 sm:w-48 lg:h-56 lg:w-56"
          >
            <Disc size="100%" spinning={isPlaying} art={artistPictureUrl} />
          </button>
        </div>
      )}

      {/* Play capsule with play button and soundwave visualizer */}
      <div className="flex items-center gap-4 bg-white/[0.04] border border-white/[0.08] rounded-full pl-3 pr-5 py-2 backdrop-blur-md shadow-lg">
        <button
          type="button"
          onClick={handlePlayPause}
          disabled={disabled}
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-neutral-950 shadow-md transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
        >
          {isPlaying ? (
            <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5">
              <path
                fillRule="evenodd"
                d="M6.75 5.25a.75.75 0 0 1 .75-.75H9a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H7.5a.75.75 0 0 1-.75-.75V5.25Zm7.5 0A.75.75 0 0 1 15 4.5h1.5a.75.75 0 0 1 .75.75v13.5a.75.75 0 0 1-.75.75H15a.75.75 0 0 1-.75-.75V5.25Z"
                clipRule="evenodd"
              />
            </svg>
          ) : (
            <svg viewBox="0 0 24 24" fill="currentColor" className="ml-0.5 h-5 w-5">
              <path d="M8 5v14l11-7z" />
            </svg>
          )}
        </button>

        {/* Soundwave bars */}
        <div className="flex items-end gap-1 h-7 w-28 border-l border-white/10 pl-3">
          {Array.from({ length: 14 }).map((_, i) => {
            const heights = [40, 70, 50, 90, 60, 80, 45, 75, 55, 95, 65, 85, 50, 70];
            const height = heights[i] ?? 40;
            return (
              <div
                key={i}
                className={`w-0.5 rounded-full transition-all duration-300 ${
                  isPlaying ? 'bg-chorusify-accent2 animate-pulse' : 'bg-slate-700'
                }`}
                style={{
                  height: isPlaying ? `${height}%` : '20%',
                  animationDelay: `${i * 60}ms`,
                  animationDuration: `${450 + (i % 3) * 150}ms`,
                }}
              />
            );
          })}
        </div>

        {!hideClock && (
          <span
            className={`text-xs font-mono font-semibold ${isPlaying ? 'text-chorusify-accent2' : 'text-slate-400'}`}
          >
            {timeLeft != null ? `${timeLeft}s` : `${stageSeconds}s`}
          </span>
        )}
      </div>

      {/* Autoplay refusals used to be invisible: the record span and the state said "playing"
          while nothing came out of the speakers. Most likely on a multiplayer round, which
          starts from a socket message rather than a tap. */}
      {blocked && (
        <p className="text-center text-xs text-amber-400" role="status">
          Tap the record to play. Your browser blocked audio from starting on its own.
        </p>
      )}

      {/* Volume slider. Phones have volume buttons, and a round needs the room. */}
      <div className="hidden items-center gap-2 w-full max-w-[220px] sm:flex">
        {/* Speaker icon */}
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-3.5 w-3.5 shrink-0 text-slate-500"
        >
          <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
        </svg>
        <input
          type="range"
          min="0"
          max="1"
          step="0.01"
          value={volume}
          onChange={(e) => setVolume(parseFloat(e.target.value))}
          className="w-full h-1 appearance-none rounded-full bg-white/10 cursor-pointer
            [&::-webkit-slider-thumb]:appearance-none
            [&::-webkit-slider-thumb]:w-3
            [&::-webkit-slider-thumb]:h-3
            [&::-webkit-slider-thumb]:rounded-full
            [&::-webkit-slider-thumb]:bg-white
            [&::-webkit-slider-thumb]:shadow-md
            [&::-webkit-slider-thumb]:transition-transform
            [&::-webkit-slider-thumb]:hover:scale-125"
          style={{ accentColor: '#fff' }}
          aria-label="Volume"
        />
        <svg
          viewBox="0 0 24 24"
          fill="currentColor"
          className="h-3.5 w-3.5 shrink-0 text-slate-500"
        >
          <path d="M13.5 4.06c0-1.336-1.616-2.005-2.56-1.06l-4.5 4.5H4.508c-1.141 0-2.318.664-2.66 1.905A9.76 9.76 0 0 0 1.5 12c0 .898.121 1.768.35 2.595.341 1.24 1.518 1.905 2.659 1.905h1.93l4.5 4.5c.945.945 2.561.276 2.561-1.06V4.06ZM18.584 5.106a.75.75 0 0 1 1.06 0c3.808 3.807 3.808 9.98 0 13.788a.75.75 0 0 1-1.06-1.06 8.25 8.25 0 0 0 0-11.668.75.75 0 0 1 0-1.06Z" />
          <path d="M15.932 7.757a.75.75 0 0 1 1.061 0 6 6 0 0 1 0 8.486.75.75 0 0 1-1.06-1.061 4.5 4.5 0 0 0 0-6.364.75.75 0 0 1 0-1.06Z" />
        </svg>
      </div>
    </div>
  );
}
