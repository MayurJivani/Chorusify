import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { useCountdownToNextPuzzle } from '../hooks/useCountdown';
import { useSession } from '../hooks/useSession';
import { getMyStats } from '../api/stats';
import { usePageTitle } from '../hooks/usePageTitle';
import { ArtistModeDemo, MultiplayerDemo } from '../features/home/ModeDemos';
import { QuickRound, useSampler } from '../features/home/QuickRound';
import type { StatsResponse } from '../types/api';

function AnimatedWaveform({ isPlaying = true }: { isPlaying?: boolean }) {
  return (
    <div className="flex h-8 items-end gap-1.5">
      {(['waveform-1', 'waveform-2', 'waveform-3', 'waveform-4', 'waveform-5'] as const).map(
        (anim, i) => (
          <span
            key={i}
            className={`w-1.5 rounded-full bg-white/70 ${isPlaying ? `animate-${anim}` : 'h-2'} transition-all duration-300`}
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ),
      )}
    </div>
  );
}

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

  const userId = user?.id;
  useEffect(() => {
    getMyStats()
      .then(setStats)
      .catch(() => setStats(null));
  }, [userId, guestId]);

  const streak = stats?.currentStreak ?? 0;
  const songs = useSampler();

  // Padding is deliberately top-light: the block still centres while it is short enough to fit,
  // but the spare room sits underneath, so the hero rides nearer the top rather than floating in
  // the middle of the viewport.
  return (
    <div className="mx-auto flex min-h-full max-w-4xl flex-col justify-center gap-4 px-4 pt-2 pb-8 sm:gap-8 sm:pt-4 sm:pb-14">
      {/* Hero kept at its original scale and wording - it is the page's anchor, and shrinking
          it to buy vertical space made the whole page read as a settings screen. */}
      <motion.div
        initial={{ opacity: 0, y: -16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: 'easeOut' }}
        className="flex flex-col items-center gap-5 text-center"
      >
        <div className="animate-float">
          <AnimatedWaveform />
        </div>
        <h1 className="text-4xl font-black tracking-tight text-white sm:text-6xl">
          Guess your <span className="text-purple-400">favourite</span> music!
        </h1>
        <p className="max-w-md text-base leading-relaxed text-slate-400">
          Hear a growing snippet and name the song in as few listens as you can.
        </p>
      </motion.div>

      {songs.length > 0 && <QuickRound songs={songs} />}

      {/* The two headline modes, each showing what happens rather than describing it */}
      <motion.section
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.1 }}
        className="grid w-full grid-cols-1 gap-3 sm:grid-cols-2"
      >
        <Link
          to="/artist"
          className="glass group flex flex-col gap-2.5 rounded-2xl border border-white/10 p-3.5 transition-all duration-300 hover:-translate-y-0.5 hover:border-chorusify-accent/40 sm:p-4"
        >
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
          className="glass group flex flex-col gap-2.5 rounded-2xl border border-white/10 p-3.5 transition-all duration-300 hover:-translate-y-0.5 hover:border-chorusify-accent2/40 sm:p-4"
        >
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
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-purple-400">
            More ways to play
          </h2>
          <span className="h-px flex-1 bg-gradient-to-l from-transparent to-white/15" />
        </div>

        {/* Two-up on phones rather than the original single column: same card, but four of
            them stacked full-width added ~330px of scrolling to a page whose whole point is
            that the modes are reachable without any. */}
        <div className="grid w-full grid-cols-2 gap-3 lg:grid-cols-4">
          {SECONDARY_MODES.map((mode) => (
            <Link
              key={mode.to}
              to={mode.to}
              className="glass group flex flex-col gap-3 rounded-2xl border border-white/10 p-4 text-left transition-all duration-300 hover:-translate-y-0.5 hover:border-white/25 sm:p-5"
            >
              <span
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-white/10 bg-white/10 text-xl"
                aria-hidden="true"
              >
                {mode.icon}
              </span>
              <span>
                <span className="block font-bold text-white">{mode.title}</span>
                <span className="mt-1 block text-sm leading-relaxed text-slate-400">
                  {mode.blurb}
                </span>
              </span>
            </Link>
          ))}
        </div>
      </motion.section>

      {/*
        The daily, demoted from the page's main button to a single strip.
        It still needs to be reachable and still needs to show the streak - that is what brings
        people back tomorrow - but as the loudest thing on the page it was absorbing nearly every
        first click, so nobody discovered the modes above.
      */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.36 }}
        className="w-full"
      >
        <Link
          to="/play"
          className="glass flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3 transition-all duration-200 hover:border-white/25"
        >
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="text-base" aria-hidden="true">
              📅
            </span>
            <div className="min-w-0">
              <span className="block text-sm font-semibold text-white">
                Today&apos;s daily challenge
              </span>
              <span className="block text-[11px] text-slate-400">
                {streak > 0 ? (
                  <>
                    <span aria-hidden="true">🔥</span>{' '}
                    <span className="font-semibold text-slate-300">{streak}</span> day streak · next
                    in <span className="font-mono">{countdown}</span>
                  </>
                ) : (
                  <>
                    One puzzle, everyone gets the same · next in{' '}
                    <span className="font-mono">{countdown}</span>
                  </>
                )}
              </span>
            </div>
          </div>
          <span className="shrink-0 text-sm font-semibold text-slate-300">Play →</span>
        </Link>
        <Link
          to="/desi"
          className="glass mt-2 flex w-full items-center justify-between gap-3 rounded-xl border border-white/10 px-4 py-3 transition-all duration-200 hover:border-white/25"
        >
          <div className="min-w-0">
            <span className="block text-sm font-semibold text-white">Desi Daily</span>
            <span className="block text-[11px] text-slate-400">
              Bollywood, Hindi classics, indie and Punjabi. Its own five songs and streak.
            </span>
          </div>
          <span className="shrink-0 text-sm font-semibold text-slate-300">Play →</span>
        </Link>
      </motion.div>

      {songs.length > 12 && (
        <ul aria-label="Songs in the bank" className="flex w-full gap-1 overflow-x-auto pb-2 pt-2">
          {songs.slice(12, 48).map((song) => (
            <li
              key={song.id}
              className="w-20 flex-none transition-transform duration-200 hover:-translate-y-1 hover:-rotate-2 sm:w-24"
            >
              <img
                src={song.albumArtUrl ?? undefined}
                alt={`${song.title} by ${song.artist}`}
                title={`${song.title} · ${song.artist}`}
                loading="lazy"
                width={96}
                height={96}
                className="aspect-square w-full rounded object-cover"
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
