import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'motion/react';
import { SnippetPlayer } from '../features/game/SnippetPlayer';
import { SongPreviewButton } from '../features/game/SongPreviewButton';
import { SnippetProgressBar } from '../features/game/SnippetProgressBar';
import { RevealMoreButton } from '../features/game/RevealMoreButton';
import { ChallengeSummary } from '../features/challenge/ChallengeSummary';
import { useGameConfig } from '../hooks/useGameConfig';
import { getEraChallenge, getEraLeaderboard, submitEraGuess } from '../api/era';
import { usePageTitle } from '../hooks/usePageTitle';
import type { EraGuessResult, EraRound, RevealedSong } from '../types/api';

type Status = 'loading' | 'playing' | 'round-ended' | 'completed' | 'error';

/**
 * Era mode: hear a song, name the year.
 *
 * One guess per round, unlike the song modes. With four years on screen a player could
 * otherwise work through them until something stuck, which turns every round into a certainty
 * rather than a judgement. Extending the snippet stays free.
 */
export function EraPlayPage() {
  usePageTitle('Guess the Year');
  const { snippetSchedule } = useGameConfig();

  const [status, setStatus] = useState<Status>('loading');
  const [round, setRound] = useState<EraRound | null>(null);
  const [result, setResult] = useState<EraGuessResult | null>(null);
  const [revealed, setRevealed] = useState<RevealedSong | null>(null);
  const [finalScore, setFinalScore] = useState<EraGuessResult['finalScore'] | null>(null);
  const [runHistory, setRunHistory] = useState<boolean[]>([]);
  const [revealedSongs, setRevealedSongs] = useState<
    { song: RevealedSong; correct: boolean; previewUrl?: string }[]
  >([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [revealCount, setRevealCount] = useState(0);
  const [autoPlay, setAutoPlay] = useState(false);

  const load = useCallback(async (playAgain?: boolean) => {
    setStatus('loading');
    setResult(null);
    setRevealed(null);
    setRevealCount(0);
    if (playAgain) {
      setRunHistory([]);
      setRevealedSongs([]);
    }
    try {
      const next = await getEraChallenge(playAgain);
      setRound(next);
      setStatus(next.completed ? 'completed' : 'playing');
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : 'Could not start an era challenge.');
      setStatus('error');
    }
  }, []);

  // StrictMode double-invokes this in development; without the guard the second pass would
  // abandon the challenge the first just created.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    void load(true);
  }, [load]);

  useEffect(() => {
    if (autoPlay) {
      const timer = setTimeout(() => setAutoPlay(false), 100);
      return () => clearTimeout(timer);
    }
  }, [autoPlay]);

  const guess = useCallback(
    async (year?: number) => {
      if (status !== 'playing' || submitting) return;
      setSubmitting(true);
      setErrorMessage(null);
      try {
        const res = await submitEraGuess({ year, guessNumber: revealCount + 1 });
        setResult(res);
        setRevealed(res.song);
        setRunHistory((prev) => [...prev, res.correct]);
        if (res.song) {
          setRevealedSongs((prev) => [
            ...prev,
            { song: res.song, correct: res.correct, previewUrl: round?.previewUrl },
          ]);
        }
        if (res.sessionComplete) setFinalScore(res.finalScore ?? null);
        setStatus('round-ended');
      } catch {
        setErrorMessage('Something went wrong submitting that. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [status, submitting, revealCount, round],
  );

  const next = useCallback(async () => {
    if (result?.sessionComplete) {
      setStatus('completed');
      return;
    }
    await load();
  }, [result, load]);

  if (status === 'loading' && !round) return <Centered>Building your challenge…</Centered>;

  if (status === 'error') {
    return (
      <Centered>
        <p className="text-slate-300">{errorMessage}</p>
        <div className="mt-4 flex gap-3">
          <button type="button" onClick={() => void load(true)} className="btn-primary">
            Try again
          </button>
          <Link to="/" className="btn-secondary">
            Other modes
          </Link>
        </div>
      </Centered>
    );
  }

  if (status === 'completed' && round) {
    return (
      <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-5 px-4 py-6">
        <ChallengeSummary
          subjectName="Guess the Year"
          songsCorrect={finalScore?.songsCorrect ?? round.songsCorrect}
          totalGuessesUsed={finalScore?.totalGuessesUsed ?? round.totalGuessesUsed}
          totalRounds={finalScore?.totalRounds ?? round.totalRounds}
          timeTakenSeconds={finalScore?.timeTakenSeconds}
          runHistory={runHistory}
          revealedSongs={revealedSongs}
          loadLeaderboard={getEraLeaderboard}
          loadDistribution={() => Promise.resolve([])}
          onPlayAgain={() => void load(true)}
          browse={{ to: '/', label: 'Try another mode' }}
        />
      </div>
    );
  }

  if (!round) return <Centered>Building your challenge…</Centered>;

  const stageIndex = Math.min(revealCount, snippetSchedule.length - 1);
  const stageSeconds = snippetSchedule[stageIndex] ?? 1;
  const canRevealMore = revealCount < snippetSchedule.length - 1;

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center gap-3 px-4 py-3 sm:gap-5 sm:py-6">
      <div className="glass flex w-full flex-col items-center gap-4 rounded-2xl p-4 sm:gap-5 sm:p-6">
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-xl font-bold text-white">Guess the Year</h1>
          <p className="font-mono text-xs text-slate-500">
            Song {Math.min(round.currentRound + 1, round.totalRounds)} of {round.totalRounds} ·{' '}
            {round.songsCorrect} correct
          </p>
        </div>

        {status === 'round-ended' && result ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full flex-col items-center gap-5 text-center"
          >
            <p
              className={`text-sm font-semibold ${
                result.correct ? 'text-emerald-400' : 'text-red-400'
              }`}
            >
              {result.correct
                ? `✓ Correct, it's ${result.answerYear}`
                : `✗ It was ${result.answerYear}`}
            </p>

            {revealed && (
              <div
                className={`flex w-full max-w-md items-center gap-4 rounded-2xl border px-4 py-3 ${
                  result.correct
                    ? 'border-emerald-500/50 bg-emerald-500/10'
                    : 'border-red-500/50 bg-red-500/10'
                }`}
              >
                {revealed.albumArtUrl ? (
                  <img
                    src={revealed.albumArtUrl}
                    alt=""
                    className="h-14 w-14 flex-shrink-0 rounded-xl object-cover ring-1 ring-white/10"
                  />
                ) : (
                  <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl">
                    🎵
                  </div>
                )}
                <div className="min-w-0 text-left">
                  <p className="truncate text-base font-bold text-white">{revealed.title}</p>
                  <p className="truncate text-xs text-slate-400">{revealed.artist}</p>
                </div>
              </div>
            )}

            {round?.previewUrl && <SongPreviewButton previewUrl={round.previewUrl} />}

            <button
              type="button"
              onClick={() => void next()}
              className="btn-primary w-full max-w-md"
            >
              {result.sessionComplete ? 'See results →' : 'Next song →'}
            </button>
          </motion.div>
        ) : (
          <>
            <SnippetProgressBar stageIndex={stageIndex} />

            {round.previewUrl && (
              <SnippetPlayer
                previewUrl={round.previewUrl}
                stageSeconds={stageSeconds}
                disabled={submitting}
                artistPictureUrl={null}
                autoPlay={autoPlay}
              />
            )}

            <div className="grid w-full max-w-md grid-cols-2 gap-2.5">
              {(round.yearOptions ?? []).map((year) => (
                <button
                  key={year}
                  type="button"
                  disabled={submitting}
                  onClick={() => void guess(year)}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-4 text-center font-mono text-xl font-black text-white transition-all duration-200 hover:border-chorusify-accent/40 hover:bg-chorusify-accent/10 active:scale-[0.96] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {year}
                </button>
              ))}
            </div>

            <div className="flex w-full max-w-md gap-2">
              <button
                type="button"
                onClick={() => void guess(undefined)}
                disabled={submitting}
                // Narrower and quieter than Reveal: this is the one that costs you the round.
                className="btn-ghost shrink-0 !rounded-xl !px-4 !py-2.5 !text-sm !text-slate-400"
              >
                Skip
              </button>
              {canRevealMore && (
                <RevealMoreButton
                  onRevealMore={() => {
                    setRevealCount((n) => n + 1);
                    setAutoPlay(true);
                  }}
                  currentSeconds={stageSeconds}
                  nextSeconds={
                    snippetSchedule[Math.min(stageIndex + 1, snippetSchedule.length - 1)]
                  }
                  disabled={submitting}
                  emphasise={revealCount === 0}
                />
              )}
            </div>

            {errorMessage && <p className="text-sm text-chorusify-danger">{errorMessage}</p>}
          </>
        )}
      </div>
    </div>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto flex min-h-full max-w-md flex-col items-center justify-center px-4 py-10 text-center text-slate-400">
      {children}
    </div>
  );
}
