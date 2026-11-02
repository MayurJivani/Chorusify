import { AnimatePresence, motion } from 'motion/react';
import type { GuessAttempt } from './useGameState';

interface GuessHistoryProps {
  history: GuessAttempt[];
}

/**
 * The guesses already spent, most recent first.
 *
 * Previously the only record of a guess was a coloured dot, so a player four attempts in had
 * no way to recall what they had already tried and could burn a turn repeating themselves.
 * Listing them also gives the "right artist" hint somewhere to live: it stays on screen for
 * the rest of the puzzle instead of flashing past.
 */
export function GuessHistory({ history }: GuessHistoryProps) {
  if (history.length === 0) return null;

  // Split history into notable (correct / right-artist) and minimal (skip / wrong) entries.
  // Notable guesses keep their card styling; skips and wrong guesses become a single compact
  // line so they stay visible without dominating the UI or stacking up.
  const entries = history.map((attempt, index) => ({ attempt, index }));
  const notable = entries.filter(({ attempt }) => attempt.correct || attempt.sameArtist);
  const minimal = entries.filter(({ attempt }) => !attempt.correct && !attempt.sameArtist);

  return (
    <div className="flex w-full flex-col gap-1.5" aria-label="Your guesses so far">
      {/* Minimal entries: skips & wrong guesses shown as a subtle inline row */}
      {minimal.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1">
          <AnimatePresence initial={false}>
            {minimal.map(({ attempt, index }, itemIndex) => {
              const skipped = attempt.song === null;
              return (
                <motion.span
                  key={index}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.15 }}
                  className="inline-flex items-center gap-1 text-xs text-slate-600"
                  title={
                    skipped
                      ? `Guess ${index + 1}: skipped`
                      : `Guess ${index + 1}: ${attempt.song?.title} · ${attempt.song?.artist}`
                  }
                >
                  <span className="font-mono text-[10px] text-slate-700">{index + 1}</span>
                  {skipped ? (
                    <span className="italic">skip</span>
                  ) : (
                    <span className="max-w-[8rem] truncate">{attempt.song?.title}</span>
                  )}
                  {itemIndex < minimal.length - 1 && (
                    <span className="text-slate-700 ml-1" aria-hidden="true">
                      ·
                    </span>
                  )}
                </motion.span>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {/* Notable entries: correct and right-artist guesses keep full card styling */}
      <AnimatePresence initial={false}>
        {notable.reverse().map(({ attempt, index }) => {
          const tone = attempt.correct
            ? 'border-emerald-500/40 bg-emerald-500/10'
            : 'border-amber-500/40 bg-amber-500/10';

          return (
            <motion.div
              key={index}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={`flex items-center gap-3 rounded-xl border px-3 py-2 text-sm ${tone}`}
            >
              <span
                className="w-4 shrink-0 text-center text-xs font-mono text-slate-500"
                aria-hidden="true"
              >
                {index + 1}
              </span>
              <span className="flex-1 truncate text-slate-200">
                {attempt.song?.title}
                <span className="text-slate-500"> · {attempt.song?.artist}</span>
              </span>
              {attempt.correct ? (
                <span className="shrink-0 text-xs font-semibold text-emerald-400">Correct</span>
              ) : (
                <span className="shrink-0 text-xs font-semibold text-amber-400">Right artist</span>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>
    </div>
  );
}
