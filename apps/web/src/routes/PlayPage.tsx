import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useGameState } from '../features/game/useGameState';
import { SnippetPlayer } from '../features/game/SnippetPlayer';
import { SnippetProgressBar } from '../features/game/SnippetProgressBar';
import { AttemptPips } from '../features/game/AttemptPips';
import { SlotProgress } from '../features/game/SlotProgress';
import { GuessHistory } from '../features/game/GuessHistory';
import { GuessInput } from '../features/game/GuessInput';
import { WinLoseOverlay } from '../features/game/WinLoseOverlay';
import { useGameConfig } from '../hooks/useGameConfig';
import { usePageTitle } from '../hooks/usePageTitle';
import { VinylSpinner } from '../features/easter-eggs/VinylSpinner';

export function PlayPage() {
  usePageTitle('Daily Puzzle');

  const {
    status,
    puzzle,
    position,
    totalSlots,
    completedSlots,
    correctCount,
    streak,
    attemptNumber,
    history,
    errorMessage,
    submitting,
    guess,
    skip,
  } = useGameState();
  const { snippetSchedule } = useGameConfig();

  const [guessFeedback, setGuessFeedback] = useState<'correct' | 'wrong' | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHistoryLen = useRef(history.length);

  useEffect(() => {
    if (history.length > prevHistoryLen.current) {
      const last = history[history.length - 1];
      if (last && !last.correct) {
        setGuessFeedback('wrong');
      } else if (last && last.correct) {
        setGuessFeedback('correct');
      }
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => setGuessFeedback(null), 800);
    }
    prevHistoryLen.current = history.length;
  }, [history]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  if (status === 'loading') {
    return (
      <Centered>
        <VinylSpinner text="Loading today's puzzle…" />
      </Centered>
    );
  }

  if (status === 'error' || !puzzle) {
    return <Centered>{errorMessage ?? 'Something went wrong.'}</Centered>;
  }

  const isOver = status === 'day-complete';
  const lastAttempt = history[history.length - 1];
  const previewUrl = puzzle.completed ? null : puzzle.previewUrl;
  const stageSeconds = snippetSchedule[Math.min(attemptNumber, snippetSchedule.length) - 1] ?? 1;
  const canRevealMore = attemptNumber < snippetSchedule.length;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-3 sm:gap-5 px-4 py-3 sm:py-6">
      {/* Glass card wrapping the game. Padding and gaps tighten on small screens so the whole
          game, record, transport, pips, input and guess list, still fits a phone viewport
          without the page scrolling. */}
      <div className="glass w-full rounded-2xl p-4 sm:p-6 flex flex-col items-center gap-3 sm:gap-4">
        <div className="flex items-center gap-2.5 text-center">
          <h1 className="text-xl font-bold text-white">Daily</h1>
          <span className="h-4 w-px bg-white/15" />
          <p className="text-xs text-slate-500 font-mono">{puzzle.puzzleDate}</p>
        </div>

        {!isOver && (
          <div className="flex flex-col items-center gap-1.5">
            <p className="text-xs text-slate-500">
              Song {position} of {totalSlots}
            </p>
            <SlotProgress
              position={position}
              totalSlots={totalSlots}
              completedSlots={completedSlots}
            />
          </div>
        )}

        <SnippetProgressBar stageIndex={attemptNumber - 1} />

        {previewUrl && !isOver && (
          <SnippetPlayer
            previewUrl={previewUrl}
            stageSeconds={stageSeconds}
            disabled={submitting}
          />
        )}

        <AttemptPips history={history} />

        {!isOver && lastAttempt?.sameArtist && (
          <p className="text-sm font-semibold text-amber-400" role="status">
            Right artist, wrong song. Keep going.
          </p>
        )}

        {!isOver && (
          <GuessInput
            onGuess={guess}
            onSkip={skip}
            onRevealMore={skip}
            canRevealMore={canRevealMore}
            currentSeconds={stageSeconds}
            nextSeconds={snippetSchedule[Math.min(attemptNumber, snippetSchedule.length - 1)]}
            // On the daily an attempt *is* the reveal, so the button must not claim to be free.
            revealCostsGuess
            emphasiseReveal={attemptNumber === 1}
            disabled={submitting}
            guessFeedback={guessFeedback}
          />
        )}

        {!isOver && <GuessHistory history={history} />}

        {errorMessage && <p className="text-sm text-chorusify-danger">{errorMessage}</p>}
      </div>

      {isOver && streak && (
        <WinLoseOverlay
          slots={completedSlots}
          correctCount={correctCount}
          totalSlots={totalSlots}
          puzzleDate={puzzle.puzzleDate}
          streak={streak}
        />
      )}
    </div>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full items-center justify-center text-slate-300">{children}</div>
  );
}
