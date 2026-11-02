import { Disc } from '../features/game/Disc';
import { AlbumWall } from '../features/home/AlbumWall';
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
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
    <div className="home-over mx-auto flex min-h-full max-w-4xl flex-col justify-center gap-4 px-4 pt-2 pb-8 sm:gap-8 sm:pt-4 sm:pb-14">
      {/* Hero kept at its original scale and wording - it is the page's anchor, and shrinking
          it to buy vertical space made the whole page read as a settings screen. */}
      <AlbumWall />
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="flex flex-col items-center gap-5 text-center"
      >
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
          Guess your <span className="text-purple-400">favourite</span> music!
        </h1>
        <p className="home-lede max-w-md text-base leading-relaxed text-slate-100">
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
        <div className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2">
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
        className="relative z-0 mt-10 grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <Link
          to="/artist"
          className="glass group relative flex flex-col gap-2.5 rounded-2xl border border-white/10 p-3.5 transition-all duration-300 hover:border-chorusify-accent/40 sm:p-4"
        >
          <span
            aria-hidden="true"
            className="absolute -top-12 right-8 -z-10 transition-transform duration-300 group-hover:-translate-y-4 group-hover:rotate-45"
          >
            <Disc kind="vinyl" size={104} />
          </span>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-base">
              🎤
            </span>
            <span className="font-bold text-white">Artist Mode</span>
            <span className="ml-auto text-xs font-semibold text-chorusify-accent transition-transform duration-200 group-hover:translate-x-0.5">
              Pick one →
            </span>
          </div>
          <ArtistModeDemo />
          <span className="text-[11px] text-slate-500">Any artist → 10 of their songs</span>
        </Link>

        <Link
          to="/multiplayer"
          className="glass group relative flex flex-col gap-2.5 rounded-2xl border border-white/10 p-3.5 transition-all duration-300 hover:border-chorusify-accent2/40 sm:p-4"
        >
          <span
            aria-hidden="true"
            className="absolute -top-12 right-8 -z-10 transition-transform duration-300 group-hover:-translate-y-4 group-hover:rotate-45"
          >
            <Disc kind="cd" size={104} />
          </span>
          <div className="flex items-center gap-2">
            <span aria-hidden="true" className="text-base">
              ⚡
            </span>
            <span className="font-bold text-white">Multiplayer</span>
            <span className="ml-auto text-xs font-semibold text-chorusify-accent2 transition-transform duration-200 group-hover:translate-x-0.5">
              Start a room →
            </span>
          </div>
          <MultiplayerDemo />
          <span className="text-[11px] text-slate-500">Same song, everyone at once</span>
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
        className="flex w-full flex-col gap-4"
      >
        <div className="flex items-center gap-3">
          <span className="h-px flex-1 bg-gradient-to-r from-transparent to-white/15" />
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-purple-300 [text-shadow:0_1px_6px_#000]">
            More ways to play
          </h2>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
        </div>

        <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
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
                <span className="block font-bold text-white">{mode.title}</span>
                <span className="mt-0.5 block text-xs leading-snug text-slate-300">
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
      className="glass flex items-center justify-between gap-3 rounded-2xl border border-white/10 px-5 py-4 transition-all duration-200 hover:-translate-y-0.5 hover:border-chorusify-accent/60"
    >
      <span className="min-w-0">
        <span className="block text-xl font-black text-white">{title}</span>
        <span className="block text-sm text-slate-300">
          {line}
          {streak > 0 && ` · ${streak} day streak`}
        </span>
      </span>
      <span className="btn-primary shrink-0 !px-4 !py-1.5 !text-sm">Play</span>
    </Link>
  );
}
