import { useEffect, useState } from 'react';
import { VinylSpinner } from '../easter-eggs/VinylSpinner';
import { motion } from 'motion/react';
import type { GuessDistributionBucket } from '../../types/api';

interface ChallengeGuessDistributionProps {
  /** Fetches the buckets. Passed in so artist and category runs can share this chart. */
  load: () => Promise<GuessDistributionBucket[]>;
}

export function ChallengeGuessDistribution({ load }: ChallengeGuessDistributionProps) {
  const [buckets, setBuckets] = useState<GuessDistributionBucket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    load()
      .then((res) => {
        if (cancelled) return;
        setBuckets(res);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setBuckets([]);
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [load]);

  if (loading) {
    return (
      <div className="py-2">
        <VinylSpinner size={28} text="Loading stats…" />
      </div>
    );
  }

  const totalAll = buckets.reduce((sum, b) => sum + b.allPlayers, 0);
  const totalMine = buckets.reduce((sum, b) => sum + b.myGuesses, 0);

  if (totalAll === 0 && totalMine === 0) return null;

  const maxAll = Math.max(...buckets.map((b) => b.allPlayers), 1);
  const maxMine = Math.max(...buckets.map((b) => b.myGuesses), 1);
  const maxCount = Math.max(maxAll, maxMine);

  const avgSeconds =
    totalAll > 0
      ? buckets.reduce((sum, b) => sum + b.snippetSeconds * b.allPlayers, 0) / totalAll
      : null;

  const myAvgSeconds =
    totalMine > 0
      ? buckets.reduce((sum, b) => sum + b.snippetSeconds * b.myGuesses, 0) / totalMine
      : null;

  return (
    <div className="flex w-full max-w-md flex-col gap-3">
      <div className="flex items-center justify-between border-b border-white/5 pb-2">
        <h3 className="text-sm font-semibold text-slate-200 uppercase tracking-wider">
          Guess Speed
        </h3>
        {avgSeconds != null && (
          <span className="text-xs text-purple-400 font-mono">Avg {avgSeconds.toFixed(1)}s</span>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        {buckets.map((bucket, i) => {
          const allWidth = maxCount > 0 ? (bucket.allPlayers / maxCount) * 100 : 0;
          const myWidth = maxCount > 0 ? (bucket.myGuesses / maxCount) * 100 : 0;

          return (
            <motion.div
              key={bucket.snippetSeconds}
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: i * 0.05 }}
              className="flex items-center gap-2 text-xs"
            >
              <span className="w-8 text-right font-mono text-slate-400 shrink-0">
                {bucket.label}
              </span>
              <div className="flex-1 flex flex-col gap-0.5">
                {bucket.allPlayers > 0 && (
                  <div className="relative h-4 rounded bg-white/5 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-purple-500/60"
                      style={{ width: `${allWidth}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-1.5 font-mono text-[10px] text-white/80">
                      {bucket.allPlayers}
                    </span>
                  </div>
                )}
                {bucket.myGuesses > 0 && (
                  <div className="relative h-4 rounded bg-white/5 overflow-hidden">
                    <div
                      className="absolute inset-y-0 left-0 rounded bg-emerald-500/60"
                      style={{ width: `${myWidth}%` }}
                    />
                    <span className="absolute inset-0 flex items-center px-1.5 font-mono text-[10px] text-white/80">
                      {bucket.myGuesses}
                    </span>
                  </div>
                )}
              </div>
            </motion.div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-4 text-xs text-slate-500 mt-1">
        <span className="flex items-center gap-1">
          <span className="inline-block w-2.5 h-2.5 rounded-sm bg-purple-500/60" />
          All players ({totalAll})
        </span>
        {totalMine > 0 && (
          <span className="flex items-center gap-1">
            <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500/60" />
            You ({totalMine})
            {myAvgSeconds != null && (
              <span className="font-mono text-purple-400 ml-1">avg {myAvgSeconds.toFixed(1)}s</span>
            )}
          </span>
        )}
      </div>

      <p className="text-[10px] text-slate-600 text-center">
        Songs guessed at each snippet duration (1s, 2s, 4s, etc.)
      </p>
    </div>
  );
}
