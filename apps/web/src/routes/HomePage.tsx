import { AlbumWall } from '../features/home/AlbumWall';
import { MiniPlayer } from '../features/home/MiniPlayer';
import { getSampler, type SamplerSong } from '../api/songs';
import { useEffect, useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { useCountdownToNextPuzzle } from '../hooks/useCountdown';
import { useSession } from '../hooks/useSession';
import { getMyStats } from '../api/stats';
import { usePageTitle } from '../hooks/usePageTitle';
import { ArtistModeDemo, MultiplayerDemo } from '../features/home/ModeDemos';
import type { StatsResponse } from '../types/api';

/**
 * The remaining modes.
 *
 * Artist Mode and Multiplayer are pulled out above into cards with demos: they are the two that
 * reward coming back, and burying them as two of six equal tiles meant nearly everyone took the
 * big daily button instead and never found them.
 *
 * Every icon on this page has to be unique — the same glyph twice reads as the same kind of
 * thing. Guess the Year is the hourglass rather than a calendar precisely because the calendar
 * belongs to the daily strip at the bottom.
 */
const SECONDARY_MODES: { to: string; icon: string; title: string; blurb: string }[] = [
  {
    to: '/categories',
    icon: '📻',
    title: 'Categories',
    blurb: 'Top hits by year, chart or genre.',
  },
  {
    to: '/survival',
    icon: '💀',
    title: 'Survival',
    blurb: 'Endless songs. One wrong answer ends the run.',
  },
  { to: '/era', icon: '⏳', title: 'Guess the Year', blurb: 'Hear a song and place it in time.' },
  {
    to: '/duels',
    icon: '⚔️',
    title: 'Duels',
    blurb: 'Rated 1v1. Same ten songs, best score wins.',
  },
];

export function HomePage() {
  usePageTitle('');
  const countdown = useCountdownToNextPuzzle();
  const { user, guestId } = useSession();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [desiStreak, setDesiStreak] = useState(0);
  const [songs, setSongs] = useState<SamplerSong[]>([]);
  const [nowPlaying, setNowPlaying] = useState<SamplerSong | null>(null);

  useEffect(() => {
    getSampler()
      .then((r) => setSongs(r.songs))
      .catch(() => setSongs([]));
  }, []);

  const userId = user?.id;
  useEffect(() => {
    getMyStats()
      .then(setStats)
      .catch(() => setStats(null));
    getMyStats('desi')
      .then((desi) => setDesiStreak(desi.currentStreak))
      .catch(() => setDesiStreak(0));
  }, [userId, guestId]);

  const streak = stats?.currentStreak ?? 0;

  // Padding is deliberately top-light: the block still centres while it is short enough to fit,
  // but the spare room sits underneath, so the hero rides nearer the top rather than floating in
  // the middle of the viewport.
  return (
    <div className="home-over mx-auto flex min-h-full max-w-4xl flex-col justify-center gap-3 px-3 py-2 sm:gap-4 sm:px-4 sm:py-3">
      {/* Hero kept at its original scale and wording - it is the page's anchor, and shrinking
          it to buy vertical space made the whole page read as a settings screen. */}
      <AlbumWall songs={songs} onPlay={setNowPlaying} playingId={nowPlaying?.id} />
      <AnimatePresence>
        {nowPlaying && (
          <MiniPlayer key={nowPlaying.id} song={nowPlaying} onClose={() => setNowPlaying(null)} />
        )}
      </AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="flex flex-col items-center gap-2 text-center sm:gap-3"
      >
        <h1
          aria-label="Guess your favourite music!"
          className="text-4xl font-black tracking-tight text-white sm:text-6xl [@media(max-height:720px)]:text-3xl"
        >
          <RisingWord text="Guess" start={0} /> <RisingWord text="your" start={5} />{' '}
          <RisingWord text="favourite" start={9} className="hop-word text-purple-400" />{' '}
          <RisingWord text="music!" start={18} />
        </h1>
        <p className="home-lede [@media(max-height:720px)]:hidden max-w-md text-sm leading-relaxed text-slate-100 sm:text-base">
          Hear a growing snippet and name the song in as few listens as you can.
        </p>
      </motion.div>

      {/* The two dailies come first: they are what brings people back tomorrow. */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        aria-label="Today's puzzles"
        className="flex w-full flex-col gap-2"
      >
        <div className="grid w-full grid-cols-2 gap-2 sm:gap-3">
          <DailyLink to="/play" title="Daily" line="5 English songs" streak={streak} />
          <DailyLink to="/desi" title="Desi Daily" line="5 Indian songs" streak={desiStreak} />
        </div>
        <p className="home-lede text-center text-xs text-slate-200">
          Same songs for everyone. New ones in <span className="font-mono">{countdown}</span>
        </p>
      </motion.section>

      {/* The two deepest modes, each showing what happens rather than describing it */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid w-full grid-cols-2 gap-2 sm:gap-3"
      >
        <Link
          to="/artist"
          className="glass group flex flex-col gap-2.5 rounded-2xl border border-white/10 p-3.5 transition-all duration-300 hover:border-chorusify-accent/40 sm:p-4"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-base">
              🎤
            </span>
            <span className="font-bold text-white">Artist Mode</span>
            <span className="ml-auto hidden text-xs font-semibold sm:inline text-chorusify-accent transition-transform duration-200 group-hover:translate-x-0.5">
              Pick one →
            </span>
          </div>
          <div className="hidden sm:block [@media(max-height:720px)]:hidden">
            <ArtistModeDemo />
          </div>
          <span className="text-xs text-slate-300 sm:text-[11px] sm:text-slate-400 [@media(max-height:720px)]:hidden">
            Any artist → 10 of their songs
          </span>
        </Link>

        <Link
          to="/multiplayer"
          className="glass group flex flex-col gap-2.5 rounded-2xl border border-white/10 p-3.5 transition-all duration-300 hover:border-chorusify-accent2/40 sm:p-4"
        >
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-base">
              ⚡
            </span>
            <span className="font-bold text-white">Multiplayer</span>
            <span className="ml-auto hidden text-xs font-semibold sm:inline text-chorusify-accent2 transition-transform duration-200 group-hover:translate-x-0.5">
              Start a room →
            </span>
          </div>
          <div className="hidden sm:block [@media(max-height:720px)]:hidden">
            <MultiplayerDemo />
          </div>
          <span className="text-xs text-slate-300 sm:text-[11px] sm:text-slate-400 [@media(max-height:720px)]:hidden">
            Same song, everyone at once
          </span>
        </Link>
      </motion.section>

      {/*
        No "how a round works" panel here on purpose. Explaining the scoring ladder on the
        landing page was teaching mechanics to someone who hasn't picked a mode yet - the job
        of this page is to get them into one. The trade is now taught where it applies, on the
        reveal control inside a round, which states the cost and the seconds gained directly.
      */}

      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.28 }}
        className="flex w-full flex-col gap-2 sm:gap-3"
      >
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-purple-300 [text-shadow:0_1px_6px_#000]">
            More ways to play
          </h2>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
        </div>

        <div className="grid w-full grid-cols-2 gap-2 lg:grid-cols-4">
          {SECONDARY_MODES.map((mode) => (
            <Link
              key={mode.to}
              to={mode.to}
              className="glass group flex items-center gap-3 rounded-2xl border border-white/10 p-3 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-white/30"
            >
              <span
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-lg"
                aria-hidden="true"
              >
                {mode.icon}
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-bold text-white sm:text-base">
                  {mode.title}
                </span>
                <span className="mt-0.5 hidden text-xs leading-snug text-slate-300 sm:block [@media(max-height:720px)]:hidden">
                  {mode.blurb}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </motion.section>
    </div>
  );
}

function DailyLink({
  to,
  title,
  line,
  streak,
}: {
  to: string;
  title: string;
  line: string;
  streak: number;
}) {
  return (
    <Link
      to={to}
      className="glass flex flex-col gap-3 rounded-2xl border border-white/10 p-3 transition-all sm:flex-row sm:items-center sm:justify-between sm:px-5 sm:py-4 duration-200 hover:-translate-y-0.5 hover:border-chorusify-accent/60"
    >
      <span className="min-w-0">
        <span className="block text-xl font-black text-white">{title}</span>
        <span className="block text-sm text-slate-300">
          {line}
          {streak > 0 && ` · ${streak} day streak`}
        </span>
      </span>
      <span className="btn-primary inline-flex shrink-0 items-center justify-center gap-1.5 !px-4 !py-1.5 !text-sm">
        <svg viewBox="0 0 16 16" fill="currentColor" className="h-3 w-3" aria-hidden="true">
          <path d="M4 2.8v10.4a.8.8 0 0 0 1.2.7l8.6-5.2a.8.8 0 0 0 0-1.4L5.2 2.1A.8.8 0 0 0 4 2.8Z" />
        </svg>
        Play
      </span>
    </Link>
  );
}

/** Letters rise into place one after another. Words stay whole so the heading wraps normally. */
function RisingWord({
  text,
  start,
  className = '',
}: {
  text: string;
  start: number;
  className?: string;
}) {
  return (
    <span aria-hidden="true" className={`inline-block whitespace-nowrap ${className}`}>
      {[...text].map((letter, i) => (
        <motion.span
          key={i}
          className="inline-block"
          style={{ '--i': i } as CSSProperties}
          initial={{ opacity: 0, y: '60%', rotate: 6 }}
          animate={{ opacity: 1, y: 0, rotate: 0 }}
          transition={{ duration: 0.9, ease: [0.16, 1, 0.3, 1], delay: 0.2 + (start + i) * 0.022 }}
        >
          {letter}
        </motion.span>
      ))}
    </span>
  );
}
