import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import confetti from 'canvas-confetti';
import { SourceStandings, ChallengeStandings } from './ChallengeLeaderboard';
import { ChallengeGuessDistribution } from './ChallengeGuessDistribution';
import { useSession } from '../../hooks/useSession';
import { renderResultCard, shareResultCard } from '../stats/resultCard';
import type {
  ArtistLeaderboardEntry,
  GuessDistributionBucket,
  RevealedSong,
  SourceStanding,
} from '../../types/api';

interface SongEntry {
  song: RevealedSong;
  correct: boolean;
  previewUrl?: string;
}

interface ChallengeSummaryProps {
  /** The artist's name or the category's label. */
  subjectName: string;
  songsCorrect: number;
  totalGuessesUsed: number;
  totalRounds: number;
  timeTakenSeconds?: number | null;
  /** Absolute URL that re-opens this exact challenge. Omitted when there's nothing to share. */
  shareUrl?: string;
  /** One entry per song answered, in order — drawn as the share grid. */
  runHistory?: boolean[];
  /** All songs revealed during the run, used to show "Songs you missed". */
  revealedSongs?: SongEntry[];
  loadLeaderboard: () => Promise<{
    entries: SourceStanding[];
    mine: Omit<SourceStanding, 'rank' | 'displayName' | 'isYou'> | null;
  }>;
  loadChallengeLeaderboard?: (() => Promise<{ entries: ArtistLeaderboardEntry[] }>) | null;
  loadDistribution: () => Promise<GuessDistributionBucket[]>;
  onPlayAgain: () => void;
  /** Back to the picker for this mode. */
  browse: { to: string; label: string };
}

function formatTime(seconds: number | null | undefined): string {
  if (seconds == null) return '--';
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

export function ChallengeSummary({
  subjectName,
  songsCorrect,
  totalGuessesUsed,
  totalRounds,
  timeTakenSeconds,
  shareUrl,
  runHistory = [],
  revealedSongs = [],
  loadLeaderboard,
  loadChallengeLeaderboard,
  loadDistribution,
  onPlayAgain,
  browse,
}: ChallengeSummaryProps) {
  const [copied, setCopied] = useState(false);
  const [rendering, setRendering] = useState(false);
  const [showMissed, setShowMissed] = useState(false);
  const [playingIndex, setPlayingIndex] = useState<number | null>(null);
  const [missedVolume, setMissedVolume] = useState(() => {
    try {
      const saved = localStorage.getItem('snippet-volume');
      if (saved != null) return parseFloat(saved);
    } catch {}
    return 0.5;
  });
  const { user } = useSession();
  const missedSongs = revealedSongs.filter((e) => !e.correct);

  useEffect(() => {
    if (songsCorrect >= totalRounds * 0.7) {
      void confetti({ particleCount: 150, spread: 90, origin: { y: 0.6 } });
    }
  }, [songsCorrect, totalRounds]);

  const handleShare = () => {
    if (!shareUrl) return;
    navigator.clipboard
      .writeText(shareUrl)
      .then(() => {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      })
      .catch(() => {});
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass flex w-full max-w-md flex-col items-center gap-6 rounded-2xl p-6 text-center border border-white/10"
    >
      <div>
        <p className="text-xs font-semibold uppercase tracking-widest text-slate-500">Complete</p>
        <p className="mt-1 text-4xl font-black text-white">
          {songsCorrect}/{totalRounds}
        </p>
        <p className="mt-1 text-sm text-slate-400">
          {totalGuessesUsed} guesses
          {timeTakenSeconds != null && (
            <span className="text-purple-400 font-semibold font-mono">
              {' '}
              · {formatTime(timeTakenSeconds)}
            </span>
          )}
        </p>
      </div>

      {/* A guest has just earned a score they can never be ranked with, so this is the moment
          the offer is worth making - right beside the leaderboard they are missing from. */}
      {!user && (
        <div className="w-full rounded-2xl border border-chorusify-accent/30 bg-chorusify-accent/10 p-4">
          <p className="text-sm font-semibold text-white">
            {songsCorrect}/{totalRounds}. Want this on the leaderboard?
          </p>
          <p className="mt-1 text-xs text-slate-300">
            Guest runs aren&apos;t ranked. Create an account to claim your spot and keep your
            scores.
          </p>
          <div className="mt-3 flex items-center justify-center gap-2">
            <Link to="/register" className="btn-primary flex-1 !py-2 text-sm">
              Claim your spot
            </Link>
            <Link to="/login" className="btn-secondary flex-1 !py-2 text-sm">
              Log in
            </Link>
          </div>
        </div>
      )}

      {/* A shared link's own board replaces the artist board: the people who played this exact
          challenge are the comparison that matters, and they all played the same songs. */}
      {loadChallengeLeaderboard ? (
        <ChallengeStandings load={loadChallengeLeaderboard} />
      ) : (
        <SourceStandings load={loadLeaderboard} subjectName={subjectName} />
      )}

      <ChallengeGuessDistribution load={loadDistribution} />

      {missedSongs.length > 0 && (
        <div className="w-full">
          <button
            type="button"
            onClick={() => setShowMissed((v) => !v)}
            className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm font-semibold text-slate-200 transition-colors hover:bg-white/[0.06]"
          >
            <span>Songs you missed ({missedSongs.length})</span>
            <span className="text-xs text-slate-500">{showMissed ? '▲' : '▼'}</span>
          </button>
          {showMissed && (
            <motion.ul
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              className="mt-2 flex flex-col gap-2"
            >
              {missedSongs.map((entry, i) => (
                <MissedSongRow
                  key={i}
                  entry={entry}
                  isPlaying={playingIndex === i}
                  onPlay={() => setPlayingIndex(i)}
                  onStop={() => setPlayingIndex(null)}
                  volume={missedVolume}
                  onVolumeChange={setMissedVolume}
                />
              ))}
            </motion.ul>
          )}
        </div>
      )}

      <div className="flex w-full flex-col gap-3">
        <button
          type="button"
          disabled={rendering}
          onClick={() => {
            setRendering(true);
            void renderResultCard({
              subject: subjectName,
              headline: `${songsCorrect}/${totalRounds}`,
              caption: timeTakenSeconds != null ? formatTime(timeTakenSeconds) : undefined,
              history: runHistory,
              totalRounds,
            })
              .then((blob) => {
                if (blob) {
                  return shareResultCard(
                    blob,
                    `chorusify-${subjectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.png`,
                    `${songsCorrect}/${totalRounds} on ${subjectName}`,
                  );
                }
              })
              .finally(() => setRendering(false));
          }}
          className="btn-primary w-full disabled:opacity-50"
        >
          {rendering ? 'Making image…' : 'Share result'}
        </button>

        {shareUrl && (
          <button
            type="button"
            onClick={handleShare}
            className="btn-secondary w-full flex items-center justify-center gap-2"
          >
            {copied ? 'Link copied!' : 'Challenge a friend'}
          </button>
        )}
        <button type="button" onClick={onPlayAgain} className="btn-secondary w-full">
          Play New Challenge
        </button>
        <Link to={browse.to} className="btn-ghost w-full text-center">
          {browse.label}
        </Link>
      </div>
    </motion.div>
  );
}

function MissedSongRow({
  entry,
  isPlaying,
  onPlay,
  onStop,
  volume,
  onVolumeChange,
}: {
  entry: SongEntry;
  isPlaying: boolean;
  onPlay: () => void;
  onStop: () => void;
  volume: number;
  onVolumeChange: (v: number) => void;
}) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (isPlaying) {
      audio.volume = volume;
      audio.play().catch(() => onStop());
    } else {
      audio.pause();
      audio.currentTime = 0;
    }
  }, [isPlaying, onStop, volume]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    const onEnded = () => onStop();
    audio.addEventListener('ended', onEnded);
    return () => audio.removeEventListener('ended', onEnded);
  }, [onStop]);

  const handleVolume = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = parseFloat(e.target.value);
      onVolumeChange(v);
      if (audioRef.current) audioRef.current.volume = v;
      try {
        localStorage.setItem('snippet-volume', String(v));
      } catch {}
    },
    [onVolumeChange],
  );

  const toggle = entry.previewUrl ? () => (isPlaying ? onStop() : onPlay()) : undefined;

  return (
    <li className="flex flex-col gap-2 rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2.5">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={toggle}
          disabled={!entry.previewUrl}
          className="relative h-10 w-10 flex-shrink-0 rounded-lg overflow-hidden group"
        >
          {entry.song.albumArtUrl ? (
            <img
              src={entry.song.albumArtUrl}
              alt=""
              className="h-full w-full object-cover ring-1 ring-white/10"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-white/10 text-sm">
              🎵
            </div>
          )}
          {entry.previewUrl && (
            <div
              className={`absolute inset-0 flex items-center justify-center bg-black/40 transition-opacity ${isPlaying ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
            >
              <span className="text-white text-lg">{isPlaying ? '⏸' : '▶'}</span>
            </div>
          )}
        </button>
        <div className="min-w-0 flex-1 text-left">
          <p className="truncate text-sm font-semibold text-white">{entry.song.title}</p>
          <p className="truncate text-xs text-slate-400">{entry.song.artist}</p>
        </div>
      </div>
      {isPlaying && entry.previewUrl && (
        <div className="flex items-center gap-2 pl-1">
          <span className="text-[10px] text-slate-500">🔈</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={handleVolume}
            className="h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 accent-purple-500 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-purple-400"
          />
          <span className="text-[10px] text-slate-500">🔊</span>
        </div>
      )}
      {entry.previewUrl && <audio ref={audioRef} src={entry.previewUrl} preload="none" />}
    </li>
  );
}
