import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { getMyStats } from '../api/stats';
import { useSession } from '../hooks/useSession';
import { GuessDistributionChart } from '../features/stats/GuessDistributionChart';
import { ShareCard } from '../features/stats/ShareCard';
import { formatDuration } from '../features/stats/formatDuration';
import { ProgressPanel } from '../features/stats/ProgressPanel';
import { usePageTitle } from '../hooks/usePageTitle';
import { VinylSpinner } from '../features/easter-eggs/VinylSpinner';
import type { StatsResponse } from '../types/api';

export function StatsPage() {
  usePageTitle('Stats');

  const { user, guestId } = useSession();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-fetch whenever the underlying identity changes (login/register/logout), not just once
  // on mount — otherwise stats from the previous session linger on screen.
  const userId = user?.id;
  useEffect(() => {
    setLoading(true);
    getMyStats()
      .then(setStats)
      .finally(() => setLoading(false));
  }, [userId, guestId]);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <VinylSpinner text="Loading stats…" />
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex min-h-full items-center justify-center text-slate-400">
        Couldn&apos;t load stats.
      </div>
    );
  }

  const winRate =
    stats.gamesPlayed > 0 ? Math.round((stats.gamesWon / stats.gamesPlayed) * 100) : 0;

  // A player who has never finished a *daily* puzzle has no streak or guess distribution to
  // show, and a screen of zeroes beside an empty chart reads as broken rather than empty. Their
  // progression still belongs here though: someone who has played fifty artist runs and no
  // dailies used to be told they had no stats at all.
  if (stats.gamesPlayed === 0) {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-4 sm:gap-6 px-4 py-4 sm:py-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass flex w-full flex-col items-center gap-4 rounded-2xl p-8"
        >
          <span className="text-4xl" aria-hidden="true">
            📊
          </span>
          <h1 className="text-2xl font-bold text-white">No daily stats yet</h1>
          <p className="max-w-sm text-sm text-slate-400">
            Finish a daily puzzle and your streak, win rate and guess distribution will show up
            here.
          </p>
          <Link to="/play" className="btn-primary mt-1">
            Play today&apos;s puzzle
          </Link>
          {!user && (
            <p className="text-xs text-slate-500">
              Playing as a guest.{' '}
              <Link to="/register" className="underline hover:text-slate-300">
                create an account
              </Link>{' '}
              to keep your streak across devices.
            </p>
          )}
        </motion.div>
        <ProgressPanel />
      </div>
    );
  }

  const timed = stats.timedWins > 0;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center gap-4 sm:gap-6 px-4 py-4 sm:py-8">
      <motion.h1
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-3xl font-extrabold gradient-text"
      >
        Your Stats
      </motion.h1>

      {/* Headline counters */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.05 }}
        className="grid w-full grid-cols-4 gap-2 text-center"
      >
        <Stat label="Played" value={stats.gamesPlayed} />
        <Stat label="Win %" value={`${winRate}%`} />
        <Stat label="Streak" value={stats.currentStreak} accent={stats.currentStreak > 0} />
        <Stat label="Best" value={stats.maxStreak} />
      </motion.div>

      {/* A win only needs one song of five; a perfect day is the stricter, rarer thing worth
          calling out on its own rather than folding into the win-rate tile above. */}
      {stats.perfectDays > 0 && (
        <p className="text-xs text-slate-500">
          {stats.perfectDays} perfect {stats.perfectDays === 1 ? 'day' : 'days'} (all 5 correct)
        </p>
      )}

      {/* Timing. Hidden entirely rather than shown as a row of dashes when no finished puzzle
          has a recorded time yet - every value here would be empty. */}
      {timed && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass w-full rounded-2xl p-4"
        >
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">Speed</h2>
            <span className="text-[11px] text-slate-500">
              from {stats.timedWins} timed {stats.timedWins === 1 ? 'win' : 'wins'}
            </span>
          </div>
          <div className="grid grid-cols-3 gap-2 text-center">
            <Stat label="Fastest" value={formatDuration(stats.fastestSolveSeconds)} accent />
            <Stat label="Average" value={formatDuration(stats.averageSolveSeconds)} />
            <Stat label="Slowest" value={formatDuration(stats.slowestSolveSeconds)} />
          </div>
        </motion.div>
      )}

      {/* How hard the wins were */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.15 }}
        className="grid w-full grid-cols-3 gap-2 text-center"
      >
        <Stat
          label="Avg guesses"
          value={stats.averageGuessesPerWin != null ? stats.averageGuessesPerWin : '-'}
        />
        <Stat label="Avg snippet" value={formatDuration(stats.averageSnippetSeconds)} />
        <Stat label="Time played" value={formatDuration(stats.totalPlaySeconds || null)} />
      </motion.div>

      {/* Guess distribution */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass w-full rounded-2xl p-5"
      >
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
            Guess distribution
          </h2>
          {stats.gamesWon > 0 && (
            <span className="text-[11px] text-slate-500">
              {stats.gamesWon} {stats.gamesWon === 1 ? 'win' : 'wins'}
            </span>
          )}
        </div>
        <GuessDistributionChart distribution={stats.guessDistribution} />
      </motion.div>

      {stats.lastPlayedDate && (
        <p className="text-xs text-slate-500">Last played {stats.lastPlayedDate}</p>
      )}

      <ShareCard stats={stats} />

      {/* Everything that is not the daily puzzle: level, mode breakdown, and the artists and
          categories this player actually knows. */}
      <div className="w-full">
        <ProgressPanel />
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string | number;
  accent?: boolean;
}) {
  return (
    <div className="glass group rounded-2xl px-2 py-4 transition-all duration-300 hover:-translate-y-0.5 hover:border-chorusify-accent/30 hover:shadow-lg hover:shadow-chorusify-accent/10">
      <p
        className={`text-xl font-extrabold tabular-nums ${accent ? 'text-chorusify-accent' : 'text-white'}`}
      >
        {value}
      </p>
      <p className="mt-1 text-[11px] leading-tight text-slate-400">{label}</p>
    </div>
  );
}
