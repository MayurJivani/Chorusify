import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { getLeaderboard } from '../api/leaderboard';
import { formatDuration } from '../features/stats/formatDuration';
import { usePageTitle } from '../hooks/usePageTitle';
import { VinylSpinner } from '../features/easter-eggs/VinylSpinner';
import type { GlobalLeaderboardEntry, LeaderboardResponse, MostPlayedArtist } from '../types/api';

const MEDALS = ['🥇', '🥈', '🥉'];

type Board = 'artist' | 'category';

export function LeaderboardPage() {
  usePageTitle('Leaderboard');
  const [data, setData] = useState<LeaderboardResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [board, setBoard] = useState<Board>('artist');

  useEffect(() => {
    getLeaderboard()
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <VinylSpinner text="Loading leaderboard…" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex min-h-full items-center justify-center text-slate-400">
        Couldn&apos;t load the leaderboard.
      </div>
    );
  }

  const { isRegistered } = data;
  const isArtist = board === 'artist';
  const players = isArtist ? data.players : data.categoryPlayers;
  const subjects = isArtist ? data.mostPlayedArtists : data.mostPlayedCategories;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center gap-6 px-4 py-8">
      <motion.h1
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-3xl font-extrabold gradient-text"
      >
        Leaderboard
      </motion.h1>

      {/* Two boards, not one. Naming ten deep cuts by a single artist and naming ten chart hits
          from 1998 reward different knowledge, so pooling them would let one mode's specialists
          crowd out the other's. */}
      <div
        role="tablist"
        aria-label="Leaderboard mode"
        className="flex rounded-xl border border-white/5 bg-chorusify-bg/80 p-1.5 gap-1.5"
      >
        {(
          [
            ['artist', 'Artist Mode'],
            ['category', 'Categories'],
          ] as [Board, string][]
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={board === value}
            onClick={() => setBoard(value)}
            className={
              'rounded-lg px-4 py-2 text-sm font-medium transition-all duration-200 ' +
              (board === value
                ? 'bg-white/10 text-white'
                : 'text-slate-400 hover:bg-white/5 hover:text-white')
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* Guests can play everything but cannot be ranked, so say so here rather than letting
          them wonder why they are missing from a board they just earned a place on. */}
      {!isRegistered && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="glass flex w-full flex-col items-center gap-3 rounded-2xl p-5 text-center"
        >
          <p className="text-sm text-slate-300">
            You&apos;re playing as a guest, so your runs aren&apos;t ranked here.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-3">
            <Link to="/register" className="btn-primary">
              Claim your spot
            </Link>
            <Link to="/login" className="btn-secondary">
              Log in
            </Link>
          </div>
        </motion.div>
      )}

      <MostPlayed
        title={isArtist ? 'Most played artists' : 'Most played categories'}
        subjects={subjects}
        hrefFor={(id) =>
          isArtist ? `/artist/${id}/play` : `/category/${encodeURIComponent(id)}/play`
        }
      />

      <TopPlayers
        players={players}
        emptyMessage={
          isArtist
            ? 'No ranked players yet. Finish an artist challenge with an account to be the first.'
            : 'No ranked players yet. Finish a category challenge with an account to be the first.'
        }
      />

      <p className="max-w-md text-center text-[11px] leading-relaxed text-slate-600">
        Ranked by total songs guessed across finished {isArtist ? 'artist' : 'category'} runs, so
        playing more counts as well as scoring well. Ties go to fewer guesses, then faster times.
      </p>
    </div>
  );
}

function MostPlayed({
  title,
  subjects,
  hrefFor,
}: {
  title: string;
  subjects: MostPlayedArtist[];
  hrefFor: (id: string) => string;
}) {
  if (subjects.length === 0) return null;

  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 }}
      className="glass w-full rounded-2xl p-5"
    >
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-slate-300">
        {title}
      </h2>
      <ul className="flex flex-col gap-1.5">
        {subjects.map((subject, index) => (
          <li key={subject.deezerArtistId}>
            <Link
              to={hrefFor(subject.deezerArtistId)}
              className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.03] px-3 py-2 text-sm transition-colors hover:border-white/20 hover:bg-white/[0.06]"
            >
              <span className="w-5 text-center font-mono text-xs text-slate-500">{index + 1}</span>
              <span className="flex-1 truncate text-slate-100">{subject.artistName}</span>
              <span className="shrink-0 font-mono text-xs text-slate-400 tabular-nums">
                {subject.runs} {subject.runs === 1 ? 'run' : 'runs'}
              </span>
              <span className="hidden shrink-0 font-mono text-xs text-slate-500 tabular-nums sm:inline">
                avg {subject.averageScore}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </motion.section>
  );
}

function TopPlayers({
  players,
  emptyMessage,
}: {
  players: GlobalLeaderboardEntry[];
  emptyMessage: string;
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.1 }}
      className="glass w-full rounded-2xl p-5"
    >
      <div className="mb-3 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Top players
        </h2>
        <span className="text-[11px] text-slate-500">by songs guessed</span>
      </div>

      {players.length === 0 ? (
        <p className="py-4 text-center text-sm text-slate-400">
          {/* Not "nobody has played yet" - the list above may well show finished runs. They were
              just played by guests, who are never ranked. */}
          {emptyMessage}
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[26rem] text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wider text-slate-500">
                <th className="w-8 pb-2 font-medium">#</th>
                <th className="pb-2 font-medium">Player</th>
                <th className="pb-2 text-right font-medium">Correct</th>
                <th className="pb-2 text-right font-medium">Acc</th>
                <th className="pb-2 text-right font-medium" title="Most songs in a single run">
                  Best
                </th>
                <th className="pb-2 text-right font-medium">Fastest</th>
              </tr>
            </thead>
            <tbody>
              {players.map((player) => (
                <tr
                  key={player.userId}
                  className={`border-t border-white/5 ${
                    player.isYou ? 'bg-chorusify-accent/10 text-white' : 'text-slate-300'
                  }`}
                >
                  <td className="py-2 font-mono text-xs text-slate-500">
                    {MEDALS[player.rank - 1] ?? player.rank}
                  </td>
                  <td className="max-w-[10rem] truncate py-2 font-medium">
                    {player.displayName}
                    {player.isYou && (
                      <span className="ml-1.5 text-[10px] uppercase text-chorusify-accent">
                        you
                      </span>
                    )}
                    <span className="ml-2 font-mono text-[11px] text-slate-500">
                      {player.runs} {player.runs === 1 ? 'run' : 'runs'}
                    </span>
                  </td>
                  <td className="py-2 text-right font-mono tabular-nums">{player.songsCorrect}</td>
                  <td className="py-2 text-right font-mono text-xs text-slate-400 tabular-nums">
                    {player.accuracy}%
                  </td>
                  <td className="py-2 text-right font-mono text-xs text-slate-400 tabular-nums">
                    {player.bestRun}
                  </td>
                  <td className="py-2 text-right font-mono text-xs text-slate-400 tabular-nums">
                    {formatDuration(player.fastestRunSeconds)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </motion.section>
  );
}
