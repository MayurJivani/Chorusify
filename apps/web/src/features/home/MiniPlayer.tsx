import { useEffect, useRef, useState } from 'react';
import { motion } from 'motion/react';
import { getSongPreview, type SamplerSong } from '../../api/songs';
import { CassetteArt } from '../game/Cassette';

/** The song picked from the wall, on a small tape deck docked at the bottom of the screen. */
export function MiniPlayer({ song, onClose }: { song: SamplerSong; onClose: () => void }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    const element = audio.current;
    setError(null);
    setProgress(0);
    getSongPreview(song.id)
      .then(({ previewUrl }) => {
        if (!live || !element) return;
        element.src = previewUrl;
        try {
          const saved = localStorage.getItem('snippet-volume');
          if (saved != null) element.volume = parseFloat(saved);
        } catch {
          /* storage unavailable */
        }
        return element.play();
      })
      .catch(() => live && setError('This preview is unavailable right now.'));
    return () => {
      live = false;
      element?.pause();
    };
  }, [song.id]);

  const toggle = () => {
    const element = audio.current;
    if (!element?.src) return;
    if (element.paused) void element.play();
    else element.pause();
  };

  return (
    <motion.div
      role="region"
      aria-label="Now playing"
      initial={{ y: 40, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26 }}
      className="mini-player fixed inset-x-2 bottom-14 z-[70] flex items-center gap-3 rounded-2xl border border-white/15 bg-[#1c1c20]/95 p-2 shadow-[0_18px_40px_rgba(0,0,0,0.7)] backdrop-blur sm:inset-x-auto sm:bottom-16 sm:left-4 sm:w-[23rem] sm:p-3"
    >
      <audio
        ref={audio}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={(e) =>
          setProgress(
            e.currentTarget.duration ? e.currentTarget.currentTime / e.currentTarget.duration : 0,
          )
        }
      />
      {/* A tape on desktop; on a phone the cover is the clearer thing to tap past. */}
      <div className="hidden w-28 flex-none sm:block">
        <CassetteArt playing={playing} progress={progress} label={song.title} />
      </div>
      {song.albumArtUrl && (
        <img
          src={song.albumArtUrl}
          alt=""
          className="h-12 w-12 flex-none rounded-lg object-cover sm:hidden"
        />
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-white">{song.title}</p>
        <p className="truncate text-xs text-slate-400">{error ?? song.artist}</p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/15">
          <div
            className="h-full origin-left bg-chorusify-accent2"
            style={{ transform: `scaleX(${progress})` }}
          />
        </div>
      </div>
      <button
        type="button"
        onClick={toggle}
        disabled={Boolean(error)}
        aria-label={playing ? 'Pause' : 'Play'}
        className="flex h-11 w-11 flex-none items-center justify-center rounded-full bg-white text-neutral-950 disabled:opacity-40"
      >
        {playing ? (
          <svg viewBox="0 0 24 24" fill="currentColor" className="h-5 w-5" aria-hidden="true">
            <rect x="6" y="5" width="4" height="14" rx="1" />
            <rect x="14" y="5" width="4" height="14" rx="1" />
          </svg>
        ) : (
          <svg
            viewBox="0 0 24 24"
            fill="currentColor"
            className="ml-0.5 h-5 w-5"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        )}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label="Close player"
        className="flex h-11 w-9 flex-none items-center justify-center text-slate-400 hover:text-white"
      >
        ✕
      </button>
    </motion.div>
  );
}
