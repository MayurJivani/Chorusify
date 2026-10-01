import { useCallback, useEffect, useState } from 'react';
import { getTodaysPuzzle, submitGuess } from '../../api/puzzle';
import { getMyStats } from '../../api/stats';
import type { DailySlotRecap, PuzzleResponse, SongSearchResult } from '../../types/api';

export type GameStatus = 'loading' | 'playing' | 'day-complete' | 'error';

export interface GuessAttempt {
  song: SongSearchResult | null; // null represents a skip
  correct: boolean;
  /** Wrong song, but by the right artist — the only real narrowing hint the game can give. */
  sameArtist?: boolean;
}

interface GameState {
  status: GameStatus;
  puzzle: PuzzleResponse | null;
  /** Which song of the day this is, 1-based. */
  position: number;
  totalSlots: number;
  /** Today's finished songs so far, in position order — the full day once status is
   *  'day-complete'. */
  completedSlots: DailySlotRecap[];
  correctCount: number;
  /** Only set once the day is complete. */
  streak: { current: number; max: number } | null;
  attemptNumber: number; // 1-based, the attempt about to be made on the current song
  history: GuessAttempt[];
  errorMessage: string | null;
  submitting: boolean;
  guess: (song: SongSearchResult) => Promise<void>;
  skip: () => Promise<void>;
}

export function useGameState(): GameState {
  const [status, setStatus] = useState<GameStatus>('loading');
  const [puzzle, setPuzzle] = useState<PuzzleResponse | null>(null);
  const [position, setPosition] = useState(1);
  const [totalSlots, setTotalSlots] = useState(0);
  const [completedSlots, setCompletedSlots] = useState<DailySlotRecap[]>([]);
  const [correctCount, setCorrectCount] = useState(0);
  const [streak, setStreak] = useState<{ current: number; max: number } | null>(null);
  const [attemptNumber, setAttemptNumber] = useState(1);
  const [history, setHistory] = useState<GuessAttempt[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  /** Applies a `/puzzle/today` response, whichever shape it is. */
  const applyPuzzle = useCallback((today: PuzzleResponse) => {
    setPuzzle(today);
    setTotalSlots(today.totalSlots);
    if (today.completed) {
      setCompletedSlots(today.slots);
      setCorrectCount(today.correctCount);
      setStatus('day-complete');
    } else {
      setCompletedSlots(today.completedSlots);
      setPosition(today.position);
      setAttemptNumber(1);
      setHistory([]);
      setStatus('playing');
    }
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const today = await getTodaysPuzzle();
        applyPuzzle(today);
        // A fresh page load after the day is already finished has no streak from this
        // session's own guesses to fall back on — ask for it directly.
        if (today.completed) {
          const stats = await getMyStats();
          setStreak({ current: stats.currentStreak, max: stats.maxStreak });
        }
      } catch {
        setStatus('error');
        setErrorMessage("Couldn't load today's puzzle. Please try again.");
      }
    })();
  }, [applyPuzzle]);

  const submit = useCallback(
    async (song: SongSearchResult | null) => {
      if (status !== 'playing' || submitting) return;
      setSubmitting(true);
      setErrorMessage(null);

      try {
        // The daily puzzle's search always returns numeric `songs.id` values (unlike Artist
        // Mode, which uses string Deezer track ids) — SongSearchResult's `id` is a union to
        // support both call sites, so narrow it back down here.
        const result = await submitGuess({
          songId: song?.id as number | undefined,
          guessNumber: attemptNumber,
        });
        setHistory((prev) => [
          ...prev,
          { song, correct: result.correct, sameArtist: result.sameArtist },
        ]);

        if (!result.isFinal) {
          setAttemptNumber((n) => n + 1);
          return;
        }

        if (result.dayComplete && result.daySummary) {
          // The last slot of the day: fold it into what we already hold for slots 1..N-1
          // rather than re-fetching — nothing left to ask the server for.
          setCompletedSlots((prev) => [
            ...prev,
            {
              position: result.position,
              won: result.correct,
              guessesUsed: attemptNumber,
              song: result.song!,
            },
          ]);
          setCorrectCount(result.daySummary.correctCount);
          setStreak({
            current: result.daySummary.currentStreak,
            max: result.daySummary.maxStreak,
          });
          setStatus('day-complete');
          return;
        }

        // Not done for the day — ask for the next song. Its `completedSlots` recap already
        // reflects the one we just finished, so there's nothing to append locally here.
        applyPuzzle(await getTodaysPuzzle());
      } catch {
        setErrorMessage('Something went wrong submitting that. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [status, submitting, attemptNumber, applyPuzzle],
  );

  const guess = useCallback((song: SongSearchResult) => submit(song), [submit]);
  const skip = useCallback(() => submit(null), [submit]);

  return {
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
  };
}
