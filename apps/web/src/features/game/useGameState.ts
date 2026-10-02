import { useCallback, useEffect, useState } from 'react';
import { getTodaysPuzzle, submitGuess } from '../../api/puzzle';
import { getMyStats } from '../../api/stats';
import type { DailySlotRecap, PuzzleResponse, SongSearchResult } from '../../types/api';

export type GameStatus = 'loading' | 'playing' | 'revealing' | 'day-complete' | 'error';

export interface GuessAttempt {
  song: SongSearchResult | null; // null represents a skip
  correct: boolean;
  /** Wrong song, but by the right artist — the only real narrowing hint the game can give. */
  sameArtist?: boolean;
}

/** The song just finished, shown on its own before moving on — win or lose, a player should
 *  see (and be able to replay) what the answer actually was, not just a flash of green or red. */
export interface RevealedSlot extends DailySlotRecap {
  /** The exact clip that was playing for this slot, so "hear the song" doesn't need a new
   *  Deezer lookup — it's already loaded, just handed over before the slot's state is dropped. */
  previewUrl: string | null;
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
  /** Set while status is 'revealing': the song just finished, for display before continuing. */
  revealedSlot: RevealedSlot | null;
  /** True once `revealedSlot` is for the day's last song — changes what "continue" does next. */
  isLastSlot: boolean;
  errorMessage: string | null;
  submitting: boolean;
  guess: (song: SongSearchResult) => Promise<void>;
  skip: () => Promise<void>;
  /** Dismisses the reveal: advances to the next song, or finishes the day if that was the last. */
  continueAfterReveal: () => Promise<void>;
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
  const [revealedSlot, setRevealedSlot] = useState<RevealedSlot | null>(null);
  const [pendingDayComplete, setPendingDayComplete] = useState(false);
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

        // The slot is done, win or lose — pause on a reveal of this song before moving on,
        // rather than silently swapping in the next one.
        const finishedSlot: DailySlotRecap = {
          position: result.position,
          won: result.correct,
          guessesUsed: attemptNumber,
          song: result.song!,
        };
        // `puzzle` here is still the pre-advance state for the slot just answered, so its
        // previewUrl is exactly the clip that was playing — nothing new to fetch.
        const previewUrl = puzzle && !puzzle.completed ? puzzle.previewUrl : null;

        if (result.dayComplete && result.daySummary) {
          setCompletedSlots((prev) => [...prev, finishedSlot]);
          setCorrectCount(result.daySummary.correctCount);
          setStreak({
            current: result.daySummary.currentStreak,
            max: result.daySummary.maxStreak,
          });
          setPendingDayComplete(true);
        } else {
          setPendingDayComplete(false);
        }

        setRevealedSlot({ ...finishedSlot, previewUrl });
        setStatus('revealing');
      } catch {
        setErrorMessage('Something went wrong submitting that. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [status, submitting, attemptNumber, puzzle],
  );

  const continueAfterReveal = useCallback(async () => {
    if (status !== 'revealing') return;
    setRevealedSlot(null);

    if (pendingDayComplete) {
      setStatus('day-complete');
      return;
    }

    try {
      // Not done for the day — ask for the next song. Its `completedSlots` recap already
      // reflects the one we just finished, so there's nothing to append locally here.
      applyPuzzle(await getTodaysPuzzle());
    } catch {
      setStatus('error');
      setErrorMessage("Couldn't load the next song. Please try again.");
    }
  }, [status, pendingDayComplete, applyPuzzle]);

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
    revealedSlot,
    isLastSlot: revealedSlot?.position === totalSlots,
    errorMessage,
    submitting,
    guess,
    skip,
    continueAfterReveal,
  };
}
