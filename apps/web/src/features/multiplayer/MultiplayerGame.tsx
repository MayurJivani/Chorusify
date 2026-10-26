import { motion } from 'framer-motion';
import type {
  MultiplayerRoomSnapshot,
  MultiplayerScoreEntry,
  SongSearchResult,
} from '../../types/api';
import { SnippetPlayer } from '../game/SnippetPlayer';
import { SnippetProgressBar } from '../game/SnippetProgressBar';
import { GuessInput } from '../game/GuessInput';
import { MultipleChoiceGuess } from '../artist/MultipleChoiceGuess';
import { RevealMoreButton } from '../game/RevealMoreButton';
import { SongPreviewButton } from '../game/SongPreviewButton';
import { MultiplayerScoreboard } from './MultiplayerScoreboard';
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
  scores: MultiplayerScoreEntry[];
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

export function MultiplayerGame({
  room,
  selfId,
  round,
  stageIndex,
  roundEnd,
  scores,
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
  const you = scores.find((s) => s.playerId === selfId);
  const answered =
    you?.answered ?? room.players.find((p) => p.playerId === selfId)?.roundAnswered ?? false;
  const isSpeed = round.gameMode === 'speed';
  const showPlayer = !room.hostOnlyAudio || isHost;
  const canGuess = !isHost || room.hostPlayable;

  const clampedStage = Math.min(stageIndex, round.snippetSchedule.length - 1);
  const stageSeconds = round.snippetSchedule[clampedStage] ?? 1;
  const atMaxStage = isSpeed || clampedStage >= round.snippetSchedule.length - 1;
  const nextSeconds = round.snippetSchedule[clampedStage + 1];
  const roundEndsAt = round.startedAt + round.roundDurationMs;
  /* The server says when the reveal ends, because a round that everybody answers finishes early
     and the scheduled round end is then a time that never happened. */
  const nextRoundAt = roundEnd?.revealEndsAt ?? roundEndsAt + round.revealDurationMs;
  const secondsLeft = useCountdownTo(roundEnd ? nextRoundAt : roundEndsAt);

  const handleGuess = (song: SongSearchResult) => onSubmitGuess(String(song.id));

  const isChoice = !!round.options && round.options.length > 0;
  /* Replaces the correct/wrong message with something that is still worth reading while you
     wait, and is the same for everyone regardless of how they did. */
  const waitingOn = scores.filter((s) => !s.answered).length;

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
          <p className="font-mono text-xs text-slate-500">
            Song {round.roundIndex + 1} of {round.totalRounds} ·{' '}
            {roundEnd ? 'next round in' : 'round ends in'}{' '}
            <span className="font-semibold text-slate-300">{secondsLeft}s</span>
          </p>
        </div>

        {roundEnd ? (
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            className="flex w-full flex-col items-center gap-5 text-center"
          >
            <h2 className="text-lg font-bold text-white">🎵 It was…</h2>
            <div className="flex w-full max-w-md items-center gap-4 rounded-2xl border border-white/10 bg-white/5 px-4 py-3">
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
            </div>

            {revealPreview && <SongPreviewButton previewUrl={revealPreview} />}

            <p className="text-sm text-slate-400">
              Next round in <span className="font-semibold text-slate-200">{secondsLeft}s</span>
            </p>
            {isHost && (
              <button type="button" onClick={onNextRound} className="btn-ghost w-full !rounded-xl">
                Skip reveal →
              </button>
            )}
          </motion.div>
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
                  disabled={answered}
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

      <MultiplayerScoreboard
        scores={scores}
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
