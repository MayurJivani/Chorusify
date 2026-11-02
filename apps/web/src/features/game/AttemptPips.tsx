import { motion } from 'motion/react';
import type { GuessAttempt } from './useGameState';
import { useGameConfig } from '../../hooks/useGameConfig';

interface AttemptPipsProps {
  history: GuessAttempt[];
}

export function AttemptPips({ history }: AttemptPipsProps) {
  const { maxGuesses } = useGameConfig();

  return (
    <div className="flex gap-3">
      {Array.from({ length: maxGuesses }, (_, i) => {
        const attempt = history[i];
        // Amber sits between wrong and correct: the guess was spent, but it narrowed things down.
        const state = !attempt
          ? 'pending'
          : attempt.correct
            ? 'correct'
            : attempt.sameArtist
              ? 'close'
              : 'wrong';

        const label =
          state === 'pending'
            ? `Guess ${i + 1}: not used yet`
            : state === 'correct'
              ? `Guess ${i + 1}: correct`
              : state === 'close'
                ? `Guess ${i + 1}: wrong song, right artist`
                : `Guess ${i + 1}: wrong`;

        return (
          <motion.span
            key={i}
            title={label}
            aria-label={label}
            animate={state === 'wrong' ? { x: [0, -6, 6, -4, 4, 0] } : {}}
            transition={{ duration: 0.35 }}
            className={
              'h-4 w-4 rounded-full border-2 transition-all duration-300 ' +
              (state === 'correct'
                ? 'border-chorusify-success bg-chorusify-success shadow-[0_0_8px_#22c55eaa]'
                : state === 'close'
                  ? 'border-amber-400 bg-amber-400 shadow-[0_0_8px_#fbbf24aa]'
                  : state === 'wrong'
                    ? 'border-chorusify-danger bg-chorusify-danger shadow-[0_0_8px_#ef4444aa]'
                    : 'border-slate-700 bg-transparent')
            }
          />
        );
      })}
    </div>
  );
}
