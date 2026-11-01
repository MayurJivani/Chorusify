import { memo, useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import type { MultiplayerRoomSnapshot, SongSearchResult } from '../../types/api';
import { SyncedAudio } from '../events/SyncedAudio';
import { SnippetPlayer } from '../game/SnippetPlayer';
import { SnippetProgressBar } from '../game/SnippetProgressBar';
import { GuessInput } from '../game/GuessInput';
import { MultipleChoiceGuess } from '../artist/MultipleChoiceGuess';
import { RevealMoreButton } from '../game/RevealMoreButton';
import { SongPreviewButton } from '../game/SongPreviewButton';
import { LiveScoreboard } from './MultiplayerScoreboard';
import { useScores, type ScoresStore } from './scoresStore';
import type {
  MultiplayerGuessResult,
  MultiplayerRound,
  MultiplayerRoundEnd,
  MultiplayerStanding,
} from './useMultiplayerGame';
import { useCountdownTo } from './useCountdownTo';

interface MultiplayerGameProps {
  room: MultiplayerRoomSnapshot;
  selfId: string | null;
  round: MultiplayerRound;
  stageIndex: number;
  roundEnd: MultiplayerRoundEnd | null;
  scoresStore: ScoresStore;
  paused?: boolean;
  audioStopped?: boolean;
  reconnecting?: boolean;
  lastGuess: MultiplayerGuessResult | null;
  standing: MultiplayerStanding | null;
  searchFn: (query: string) => Promise<SongSearchResult[]>;
  onSubmitGuess: (trackId: string) => void;
  onReveal: () => void;
  onNextRound: () => void;
  /** Mid-game exit. Without it the only way out was closing the tab, which looks to everyone
   *  else exactly like a crash and leaves the player no way back to the rest of the site. */
  onLeave: () => void;
}

/** Ticks on its own, so the rest of the game does not re-render every half second. */
const Countdown = memo(function Countdown({ to }: { to: number }) {
  const secondsLeft = useCountdownTo(to);
  return <span className="font-semibold tabular-nums text-slate-200">{secondsLeft}s</span>;
});

/** True once `at` has passed on this device's clock. */
function useReached(at: number): boolean {
  const [reached, setReached] = useState(() => Date.now() >= at);
  useEffect(() => {
    const wait = at - Date.now();
    setReached(wait <= 0);
    if (wait <= 0) return;
    const timer = setTimeout(() => setReached(true), wait);
    return () => clearTimeout(timer);
  }, [at]);
  return reached;
}

/** A row of bars that moves only while music is meant to be playing, and sits still otherwise. */
function ListenBars({ active }: { active: boolean }) {
  return (
    <span aria-hidden="true" className="flex h-8 items-end gap-1">
      {[0.55, 1, 0.7, 0.9, 0.5].map((height, i) => (
        <span
          key={i}
          className={`w-1.5 origin-bottom rounded-full bg-chorusify-accent2 ${active ? 'motion-safe:animate-listen' : 'opacity-40'}`}
          style={{ height: `${height * 100}%`, animationDelay: `${i * 90}ms` }}
        />
      ))}
    </span>
  );
}

function EventQuestion({ listening, active }: { listening: string; active: boolean }) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.97 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
      className="flex flex-col items-center gap-2 py-3 text-center"
    >
      <ListenBars active={active} />
      <p className="text-sm font-medium text-slate-200">{listening}</p>
    </motion.div>
  );
}

export function MultiplayerGame({
  room,
  selfId,
  round,
  stageIndex,
  roundEnd,
  scoresStore,
  paused = false,
  audioStopped = false,
  reconnecting = false,
  lastGuess,
  standing,
  searchFn,
  onSubmitGuess,
  onReveal,
  onNextRound,
  onLeave,
}: MultiplayerGameProps) {
  const isHost = selfId === room.hostId;
  /**
   * Answered state comes from `scores`, not the room snapshot.
   *
   * After a guess the server broadcasts `scores` and nothing else — `room_state` is only sent
   * on membership changes — so `room.players[].roundAnswered` still reads false for the rest
   * of the round. Reading it left a player who had already answered looking like they hadn't:
   * the guess UI stayed live and nothing marked what they'd picked.
   */
  const scoreRowAnswered = useScores(
    scoresStore,
    (s) => s.rows.find((row) => row.playerId === selfId)?.answered,
  );
  /* Outside the top ten there is no row for you, and your own guess result is what says so. */
  const answered =
    scoreRowAnswered ??
    (lastGuess != null || room.players.find((p) => p.playerId === selfId)?.roundAnswered) ??
    false;
  const isEvent = !!room.event;
  const started = useReached(isEvent ? round.startedAt : 0);
  const isSpeed = round.gameMode === 'speed';
  const showPlayer = !room.hostOnlyAudio || isHost;
  const canGuess = !isHost || room.hostPlayable;
  const stageMs = (round.snippetSchedule[0] ?? 0) * 1000;
  const musicPlaying = started && !paused && !audioStopped && Date.now() < round.startedAt + stageMs;

  const clampedStage = Math.min(stageIndex, round.snippetSchedule.length - 1);
  const stageSeconds = round.snippetSchedule[clampedStage] ?? 1;
  const atMaxStage = isSpeed || clampedStage >= round.snippetSchedule.length - 1;
  const nextSeconds = round.snippetSchedule[clampedStage + 1];
  const roundEndsAt = round.startedAt + round.roundDurationMs;
  /* The server says when the reveal ends, because a round that everybody answers finishes early
     and the scheduled round end is then a time that never happened. */
  const nextRoundAt = roundEnd?.revealEndsAt ?? roundEndsAt + round.revealDurationMs;

  const handleGuess = (song: SongSearchResult) => onSubmitGuess(String(song.id));

  const isChoice = !!round.options && round.options.length > 0;
  /* Replaces the correct/wrong message with something that is still worth reading while you
     wait, and is the same for everyone regardless of how they did. */
  const waitingOn = useScores(scoresStore, (s) =>
    s.totalPlayers != null && s.answeredCount != null
      ? s.totalPlayers - s.answeredCount
      : s.rows.filter((row) => !row.answered).length,
  );

  /*
   * The answer is offered rather than played.
   *
   * Autoplaying it was a persistent source of faults — seeking before metadata loaded, resuming
   * into the last second of a short preview, restarting when the effect re-ran — and every one
   * of those was a worse experience than silence. A button also puts the room in control: the
   * reveal is when people are talking about the song, and audio starting over the top of that
   * is an interruption as often as it is useful.
   */
  const revealPreview = roundEnd?.correct?.previewUrl ?? null;
  /** What this player locked in, so the option list can mark it while the round finishes. */
  const lockedGuessId =
    answered && isChoice && lastGuess ? (lastGuess.guessedTrackId ?? null) : null;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-2 sm:gap-6 px-4 py-2 sm:py-8">
      <div className="glass flex w-full flex-col items-center gap-2.5 sm:gap-4 rounded-2xl p-3 sm:p-6">
        {/* Header */}
        <div className="flex w-full flex-col items-center gap-1 text-center">
          <h1 className="text-xl font-bold text-white">{room.label}</h1>
          <p className="text-xs text-slate-400">
            Song {round.roundIndex + 1} of {round.totalRounds} ·{' '}
            {paused ? (
              <span className="font-semibold text-amber-200">paused by the host</span>
            ) : (
              <>
                {roundEnd ? 'next round in' : !started ? 'starting in' : 'round ends in'}{' '}
                <Countdown to={roundEnd ? nextRoundAt : started ? roundEndsAt : round.startedAt} />
              </>
            )}
          </p>
          {reconnecting && (
            <p role="status" className="text-xs font-medium text-amber-200">
              Connection lost. Getting you back in…
            </p>
          )}
        </div>

        {roundEnd ? (
          <motion.div
            key={`reveal-${round.roundIndex}`}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: [0.16, 1, 0.3, 1] }}
            className="flex w-full flex-col items-center gap-5 text-center"
          >
            <h2 className="text-lg font-bold text-white">🎵 It was…</h2>
            <motion.div
              initial={{ scale: 0.92 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 22, delay: 0.08 }}
              className="flex w-full max-w-md items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3"
            >
              {roundEnd.correct?.albumArtUrl ? (
                <img
                  src={roundEnd.correct.albumArtUrl}
                  alt=""
                  className="h-14 w-14 flex-shrink-0 rounded-xl object-cover shadow-lg ring-1 ring-white/10"
                />
              ) : (
                <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-xl bg-white/10 text-xl">
                  🎵
                </div>
              )}
              <div className="min-w-0 text-left">
                <p className="truncate text-base font-bold text-white">
                  {roundEnd.correct?.title ?? 'Unknown'}
                </p>
                <p className="truncate text-xs text-slate-400">{roundEnd.correct?.artist ?? ''}</p>
              </div>
            </motion.div>

            {revealPreview && <SongPreviewButton previewUrl={revealPreview} />}

            <p className="text-sm text-slate-400">
              Next round in <Countdown to={nextRoundAt} />
            </p>
            {isHost && !isEvent && (
              <button type="button" onClick={onNextRound} className="btn-ghost w-full !rounded-xl">
                Skip reveal →
              </button>
            )}
          </motion.div>
        ) : isEvent && room.hostOnlyAudio && !isHost ? (
          <EventQuestion
            key={round.roundIndex}
            listening="Listen to the speakers"
            active={musicPlaying}
          />
        ) : isEvent ? (
          <>
            <EventQuestion
              key={round.roundIndex}
              listening={started ? 'Listen' : 'Get ready'}
              active={musicPlaying}
            />
            {round.previewUrl && (
              <SyncedAudio
                previewUrl={round.previewUrl}
                playAt={round.startedAt}
                playbackSeconds={round.snippetSchedule[0] ?? 15}
                paused={paused}
                stopped={audioStopped}
              />
            )}
          </>
        ) : (
          <>
            {showPlayer && !isSpeed && <SnippetProgressBar stageIndex={stageIndex} />}

            {showPlayer && (
              <SnippetPlayer
                previewUrl={round.previewUrl}
                stageSeconds={stageSeconds}
                playSignal={stageIndex + 1}
                fixedOffsetSeconds={0}
                artistPictureUrl={round.pictureUrl}
              />
            )}

            {!showPlayer && (
              <div className="flex flex-col items-center gap-2 py-4 text-center">
                <span className="text-3xl">🔊</span>
                <p className="text-sm text-slate-400">Music is playing on the host&apos;s device</p>
              </div>
            )}

            {showPlayer &&
              !isSpeed &&
              (atMaxStage ? (
                <p className="w-full max-w-md rounded-xl border border-white/10 bg-white/5 py-2.5 text-center text-sm text-slate-400">
                  Full snippet unlocked - go on, guess!
                </p>
              ) : (
                <div className="flex w-full max-w-md">
                  <RevealMoreButton
                    onRevealMore={onReveal}
                    currentSeconds={stageSeconds}
                    nextSeconds={nextSeconds}
                    disabled={answered}
                    emphasise={round.roundIndex === 0 && stageIndex === 0 && !answered}
                  />
                </div>
              ))}

            </>
        )}

        {!roundEnd && (
          <>
            {!canGuess ? (
              <div className="flex flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3 w-full max-w-md">
                <p className="text-sm font-medium text-slate-300">Streaming mode</p>
                <p className="text-xs text-slate-500">
                  You&apos;re the DJ - sit back and play the music
                </p>
              </div>
            ) : isChoice ? (
              /* The options stay mounted after answering so the locked pick remains visible;
                 a compact status strip sits above them instead of replacing the whole list. */
              <div className="flex w-full max-w-md flex-col gap-2">
                {/* Neutral on purpose: the result lands at the reveal, with everyone else's. */}
                {answered && (
                  <motion.div
                    initial={{ opacity: 0, y: -4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex items-center justify-center gap-2 rounded-xl border border-chorusify-accent2/25 bg-chorusify-accent2/5 px-3 py-2 text-center"
                  >
                    <p className="text-sm font-semibold text-chorusify-accent2">
                      {/* In a big room the scoreboard shows the top ten and you are not on it,
                          so your own standing comes back with your guess instead. */}
                      {lastGuess?.yourRank && lastGuess.totalPlayers
                        ? `#${lastGuess.yourRank} of ${lastGuess.totalPlayers}`
                        : 'Locked in'}
                      <span className="ml-2 font-normal text-slate-400">
                        {waitingOn > 0 ? `waiting on ${waitingOn} more` : 'waiting for the reveal…'}
                      </span>
                    </p>
                  </motion.div>
                )}
                <MultipleChoiceGuess
                  options={round.options!}
                  onGuess={handleGuess}
                  onSkip={() => onSubmitGuess('__pass__')}
                  lockedGuessId={lockedGuessId}
                  disabled={answered || paused || !started}
                  dense
                  twoColumn
                />
              </div>
            ) : answered ? (
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex w-full max-w-md flex-col items-center gap-1 rounded-xl border border-white/10 bg-white/5 px-4 py-3"
              >
                {/* Search mode, same rule: answered, but not told whether it landed. */}
                <p className="text-lg font-bold text-chorusify-accent2">Locked in</p>
                <p className="text-xs text-slate-400">
                  {waitingOn > 0
                    ? `Waiting on ${waitingOn} more ${waitingOn === 1 ? 'player' : 'players'}…`
                    : 'No changing it - the answer comes with the reveal.'}
                </p>
              </motion.div>
            ) : (
              <GuessInput
                onGuess={handleGuess}
                onSkip={() => onSubmitGuess('__pass__')}
                searchFn={searchFn}
              />
            )}
          </>
        )}
      </div>

      <LiveScoreboard
        store={scoresStore}
        selfId={selfId}
        hostId={room.hostId}
        showRoundState
        standing={standing}
        limit={10}
        title="Live standings"
      />

      {/* Understated on purpose: leaving mid-race should be possible, not inviting. */}
      <button
        type="button"
        onClick={onLeave}
        className="text-xs text-slate-500 underline decoration-dotted transition-colors hover:text-slate-300"
      >
        Leave room
      </button>
    </div>
  );
}
