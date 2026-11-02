import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { SnippetPlayer } from '../game/SnippetPlayer';
import { VinylSpinner } from '../easter-eggs/VinylSpinner';
import { SongPreviewButton } from '../game/SongPreviewButton';
import { SnippetProgressBar } from '../game/SnippetProgressBar';
import { AttemptPips } from '../game/AttemptPips';
import { GuessInput } from '../game/GuessInput';
import { MultipleChoiceGuess } from '../artist/MultipleChoiceGuess';
import { type SongSearchResult } from '../../types/api';
import { useGameConfig } from '../../hooks/useGameConfig';
import type { ChallengeGameState } from './useChallengeGameState';

interface ChallengeRunnerProps {
  game: ChallengeGameState;
  guessMode: 'search' | 'choice';
  /** Typeahead over the run's whole candidate pool, not just its ten answers. */
  searchFn: (query: string) => Promise<SongSearchResult[]>;
  /** The end-of-run screen. Rendered by the caller because artist and category runs show
   *  different leaderboards and different "play something else" links. */
  summary: ReactNode;
  /** Shown under the skeleton once the first load stops feeling instant. */
  slowLoadHint: string;
  /** Where "pick something else" goes when a run can't be built at all. */
  fallback: { to: string; label: string };
  /** Set when this run came from a shared link and the sender has already finished it. */
  duel?: { displayName: string; songsCorrect: number; totalRounds: number } | null;
}

/**
 * The round screen, shared by Artist Mode and Category Mode.
 *
 * The two modes play by identical rules, so this owns everything about *playing* a run —
 * snippets, attempts, reveals — and the pages above it own only what differs: which endpoints
 * feed it and what the summary looks like.
 */
export function ChallengeRunner({
  game,
  guessMode,
  searchFn,
  summary,
  slowLoadHint,
  fallback,
  duel,
}: ChallengeRunnerProps) {
  const { snippetSchedule } = useGameConfig();
  const {
    status,
    challenge,
    attemptNumber,
    roundHistory,
    revealedSong,
    sessionComplete,
    errorMessage,
    submitting,
    guess,
    skip,
    nextRound,
  } = game;

  // Guess feedback flash for search mode
  const [guessFeedback, setGuessFeedback] = useState<'correct' | 'wrong' | null>(null);
  const feedbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevHistoryLen = useRef(roundHistory.length);

  useEffect(() => {
    if (roundHistory.length > prevHistoryLen.current) {
      const last = roundHistory[roundHistory.length - 1];
      if (last) setGuessFeedback(last.correct ? 'correct' : 'wrong');
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
      feedbackTimerRef.current = setTimeout(() => setGuessFeedback(null), 800);
    }
    prevHistoryLen.current = roundHistory.length;
  }, [roundHistory]);

  useEffect(() => {
    return () => {
      if (feedbackTimerRef.current) clearTimeout(feedbackTimerRef.current);
    };
  }, []);

  // Auto-play snippet after a skip in choice mode
  const [autoPlaySnippet, setAutoPlaySnippet] = useState(false);

  // Reset autoPlay after the snippet player has had a chance to pick it up
  useEffect(() => {
    if (autoPlaySnippet) {
      const t = setTimeout(() => setAutoPlaySnippet(false), 100);
      return () => clearTimeout(t);
    }
  }, [autoPlaySnippet]);

  // Tracks how many times the user has locally extended the snippet within the current round.
  // Works for both search and choice modes — "Reveal more" extends audio without spending a guess.
  const [localRevealCount, setLocalRevealCount] = useState(0);

  const revealMore = useCallback(() => {
    setLocalRevealCount((n) => n + 1);
    setAutoPlaySnippet(true);
  }, []);

  const canRevealMore = localRevealCount < snippetSchedule.length - 1;

  // Reset localRevealCount when the round changes
  const prevRound = useRef(challenge?.currentRound);
  useEffect(() => {
    if (!challenge) return;
    if (challenge.currentRound !== prevRound.current) {
      setLocalRevealCount(0);
    }
    prevRound.current = challenge.currentRound;
  }, [challenge]);

  if (status === 'loading') {
    return <ChallengeLoading slowHint={slowLoadHint} />;
  }

  if (status === 'error' || !challenge) {
    return <ChallengeError message={errorMessage ?? 'Something went wrong.'} fallback={fallback} />;
  }

  if (status === 'completed') {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-4 sm:gap-6 px-4 py-4 sm:py-8">
        {summary}
      </div>
    );
  }

  const previewUrl = !challenge.completed ? challenge.previewUrl : null;

  // The stage index is determined by how many local reveals the user made
  // OR the server's attempt number (whichever is higher).
  const stageIndex = Math.max(localRevealCount, attemptNumber - 1);
  const stageSeconds = snippetSchedule[Math.min(stageIndex, snippetSchedule.length - 1)] ?? 1;
  const nextRevealSeconds = snippetSchedule[Math.min(stageIndex + 1, snippetSchedule.length - 1)];
  /* Nudge the reveal only on the opening round, before anyone has stretched a snippet. Once
     they have used it (or moved past round one) the pulse has done its job and would just be
     motion on the screen while they are trying to listen. */
  const emphasiseReveal = challenge.currentRound === 0 && localRevealCount === 0;

  const lastAttempt = roundHistory[roundHistory.length - 1];

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-3 sm:gap-5 px-4 py-3 sm:py-6">
      {/* The mark to beat, kept in view for the whole run: a duel where you only learn the
          target at the end is just a solo run with a scoreboard afterwards. */}
      {duel && (
        <div className="flex w-full items-center justify-center gap-2 rounded-xl border border-chorusify-accent/30 bg-chorusify-accent/10 px-4 py-2 text-sm">
          <span className="font-semibold text-white">{duel.displayName}</span>
          <span className="text-slate-400">scored</span>
          <span className="font-mono font-bold text-chorusify-accent">
            {duel.songsCorrect}/{duel.totalRounds}
          </span>
          <span className="text-slate-400">on this challenge</span>
        </div>
      )}

      {/* Glass game card */}
      <div className="glass w-full rounded-2xl p-4 sm:p-6 flex flex-col items-center gap-4 sm:gap-5">
        {/* Header */}
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-xl font-bold text-white">{challenge.artistName}</h1>
          <p className="text-xs text-slate-500 font-mono">
            Song {challenge.currentRound + 1} of {challenge.totalRounds} · {challenge.songsCorrect}{' '}
            correct
          </p>
        </div>

        {status === 'round-ended' && revealedSong ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full flex-col items-center gap-5 text-center"
          >
            <p
              className={`text-sm font-semibold ${
                lastAttempt?.correct ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {lastAttempt?.correct ? '✓ Correct!' : '✗ Not this time, it was:'}
            </p>
            <div
              className={`flex items-center gap-4 px-4 py-3 rounded-2xl border w-full max-w-md ${
                lastAttempt?.correct
                  ? 'bg-emerald-500/10 border-emerald-500/50'
                  : 'bg-red-500/10 border-red-500/50'
              }`}
            >
              {revealedSong.albumArtUrl ? (
                <img
                  src={revealedSong.albumArtUrl}
                  alt=""
                  className="h-14 w-14 rounded-xl object-cover shadow-lg ring-1 ring-white/10 flex-shrink-0"
                />
              ) : (
                <div className="h-14 w-14 rounded-xl bg-white/10 flex items-center justify-center text-xl flex-shrink-0">
                  🎵
                </div>
              )}
              <div className="text-left overflow-hidden">
                <p className="font-bold text-white text-base truncate">{revealedSong.title}</p>
                <p className="text-xs text-slate-400 truncate">{revealedSong.artist}</p>
              </div>
            </div>

            {previewUrl && <SongPreviewButton previewUrl={previewUrl} />}

            {guessMode === 'choice' && 'options' in challenge && challenge.options ? (
              <MultipleChoiceGuess
                options={challenge.options}
                onGuess={guess}
                onSkip={skip}
                disabled={true}
                revealedSong={revealedSong}
                roundEnded={true}
                selectedGuessId={lastAttempt?.song?.id as string | undefined}
              />
            ) : null}

            <button
              type="button"
              onClick={() => void nextRound()}
              className="btn-primary w-full max-w-md"
            >
              {sessionComplete ? 'See results →' : 'Next song →'}
            </button>
          </motion.div>
        ) : (
          <>
            <SnippetProgressBar stageIndex={stageIndex} />

            {previewUrl && (
              <SnippetPlayer
                previewUrl={previewUrl}
                stageSeconds={stageSeconds}
                disabled={submitting}
                artistPictureUrl={challenge.artistPictureUrl}
                autoPlay={autoPlaySnippet}
              />
            )}

            <AttemptPips history={roundHistory} />

            {guessMode === 'choice' && 'options' in challenge && challenge.options ? (
              <MultipleChoiceGuess
                options={challenge.options}
                onGuess={guess}
                onSkip={skip}
                onRevealMore={revealMore}
                canRevealMore={canRevealMore}
                currentSeconds={stageSeconds}
                nextSeconds={nextRevealSeconds}
                emphasiseReveal={emphasiseReveal}
                disabled={submitting}
                revealedSong={revealedSong}
                roundEnded={false}
              />
            ) : (
              <GuessInput
                onGuess={guess}
                onSkip={skip}
                onRevealMore={revealMore}
                canRevealMore={canRevealMore}
                currentSeconds={stageSeconds}
                nextSeconds={nextRevealSeconds}
                emphasiseReveal={emphasiseReveal}
                disabled={submitting}
                searchFn={searchFn}
                guessFeedback={guessFeedback}
              />
            )}

            {errorMessage && <p className="text-sm text-chorusify-danger">{errorMessage}</p>}
          </>
        )}
      </div>
    </div>
  );
}

/**
 * The first person to open an artist waits on a full Deezer catalog crawl, which can run to
 * several seconds for a large discography (later visitors hit the cached pool and load
 * instantly). A bare "Loading…" for that long reads as a hung page, so this shows a pulsing
 * skeleton of the game card and, once the wait stops feeling instant, explains *why*.
 */
function ChallengeLoading({ slowHint }: { slowHint: string }) {
  const { snippetSchedule } = useGameConfig();
  const [showSlowHint, setShowSlowHint] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setShowSlowHint(true), 1500);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-3 sm:gap-5 px-4 py-3 sm:py-6">
      <div
        className="glass w-full rounded-2xl p-6 flex flex-col items-center gap-5"
        role="status"
        aria-live="polite"
      >
        <span className="sr-only">Loading challenge</span>

        <div className="flex flex-col items-center gap-2 w-full">
          <div className="h-5 w-40 rounded-lg bg-white/10 animate-pulse" />
          <div className="h-3 w-28 rounded-lg bg-white/5 animate-pulse" />
        </div>

        <div className="flex gap-1.5 w-full justify-center" aria-hidden="true">
          {snippetSchedule.map((seconds) => (
            <div key={seconds} className="h-1.5 flex-1 max-w-12 rounded-full bg-white/5" />
          ))}
        </div>

        {/* Sits where the album art lands, so the wait spins a record in the slot the game
            is about to fill rather than pulsing an empty box. */}
        <VinylSpinner size={112} text="" />

        <div className="w-full space-y-2">
          <div className="h-11 w-full rounded-xl bg-white/[0.07] animate-pulse" />
          <div className="h-11 w-full rounded-xl bg-white/[0.05] animate-pulse" />
          <div className="h-11 w-full rounded-xl bg-white/[0.03] animate-pulse" />
        </div>

        <p className="text-sm text-slate-400 text-center">
          {showSlowHint ? slowHint : 'Building your challenge…'}
        </p>
      </div>
    </div>
  );
}

function ChallengeError({
  message,
  fallback,
}: {
  message: string;
  fallback: { to: string; label: string };
}) {
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-3 sm:gap-5 px-4 py-3 sm:py-6">
      <div className="glass w-full rounded-2xl p-8 flex flex-col items-center gap-5 text-center">
        <div className="text-3xl" aria-hidden="true">
          🎧
        </div>
        <div className="flex flex-col gap-1">
          <h1 className="text-lg font-bold text-white">Couldn’t start this challenge</h1>
          <p className="text-sm text-slate-400">{message}</p>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3">
          <button type="button" onClick={() => window.location.reload()} className="btn-primary">
            Try again
          </button>
          <Link to={fallback.to} className="btn-secondary">
            {fallback.label}
          </Link>
        </div>
      </div>
    </div>
  );
}
