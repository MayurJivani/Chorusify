import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { getHostedEvent } from '../api/events';
import { MultipleChoiceGuess } from '../features/artist/MultipleChoiceGuess';
import { SharePanel } from '../features/events/SharePanel';
import { SyncedAudio } from '../features/events/SyncedAudio';
import { LiveScoreboard } from '../features/multiplayer/MultiplayerScoreboard';
import { useScores } from '../features/multiplayer/scoresStore';
import { useCountdownTo } from '../features/multiplayer/useCountdownTo';
import { useMultiplayerGame, type HostRound } from '../features/multiplayer/useMultiplayerGame';
import { usePageTitle } from '../hooks/usePageTitle';
import { ensureMediaUnlocked } from '../features/game/SnippetPlayer';
import type { HostedEvent } from '../types/api';

export function EventConsolePage() {
  usePageTitle('Event console');
  const { id = '' } = useParams<{ id: string }>();
  const [event, setEvent] = useState<HostedEvent | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    getHostedEvent(id).then(
      (r) => setEvent(r.event),
      () => setLoadError('This event does not exist, or is not yours.'),
    );
  }, [id]);

  if (loadError) {
    return (
      <div className="mx-auto max-w-md px-4 py-16 text-center">
        <p className="text-slate-300">{loadError}</p>
        <Link to="/events" className="btn-primary mt-4 inline-block">
          Back to events
        </Link>
      </div>
    );
  }
  return event ? <Console event={event} /> : null;
}

function Console({ event }: { event: HostedEvent }) {
  const game = useMultiplayerGame(event.code, '', { hostEventId: event.id });
  const {
    room,
    hostRound,
    paused,
    audioStopped,
    roundEnd,
    gameOver,
    connectionStatus,
    hostCommand,
  } = game;
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [audioFailed, setAudioFailed] = useState<number | null>(null);

  const phase = gameOver ? 'finished' : (room?.phase ?? 'lobby');
  const inRound = phase === 'playing' || phase === 'round-reveal';
  const playerCount = room?.playerCount ?? room?.players.length ?? 0;
  const hostOnly = event.audioMode === 'host_only';

  return (
    <div className="mx-auto grid w-full max-w-6xl gap-5 px-4 py-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="flex min-w-0 flex-col gap-5">
        <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <h1 className="text-2xl font-extrabold text-white">{event.name}</h1>
          <p className="text-sm text-slate-400" aria-live="polite">
            <PlayerCount count={playerCount} /> ·{' '}
            {connectionStatus === 'open' ? (
              <span className="text-emerald-400">Connected</span>
            ) : (
              <span className="text-amber-300">Reconnecting…</span>
            )}
          </p>
        </header>

        {game.closedReason && (
          <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
            {game.closedReason}
          </p>
        )}
        {game.errorCode === 'not_host' && (
          <p role="alert" className="rounded-xl bg-red-500/10 p-3 text-sm text-red-200">
            This account can no longer host this event.
          </p>
        )}
        {game.skippedSong && (
          <p className="rounded-xl bg-amber-400/10 p-3 text-sm text-amber-100">
            Skipped &ldquo;{game.skippedSong}&rdquo;: Deezer no longer has audio for it.
          </p>
        )}

        <section aria-label="Live controls" className="glass rounded-2xl p-4 sm:p-5">
          <AnimatePresence mode="wait" initial={false}>
            {phase === 'finished' ? (
              <motion.div key="done" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <h2 className="text-lg font-bold text-white">Event over</h2>
                <p className="mt-1 text-sm text-slate-400">
                  {gameOver?.winner
                    ? `${gameOver.winner.displayName} won with ${gameOver.winner.score} points.`
                    : 'Nobody scored.'}{' '}
                  The result is saved.
                </p>
                <Link
                  to="/events"
                  className="btn-secondary mt-4 inline-block !rounded-xl !py-2 !text-sm"
                >
                  Back to events
                </Link>
              </motion.div>
            ) : !inRound ? (
              <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <h2 className="text-lg font-bold text-white">
                  {phase === 'starting' ? 'Starting…' : 'Waiting for players'}
                </h2>
                <p className="mt-1 text-sm text-slate-400">
                  {hostOnly
                    ? 'Connect this device to the speakers. It is the only one that plays the music.'
                    : 'Every player’s phone plays the music, so ask them to turn their sound on.'}
                </p>
                <button
                  type="button"
                  disabled={
                    playerCount === 0 || phase === 'starting' || connectionStatus !== 'open'
                  }
                  onClick={() => {
                    ensureMediaUnlocked();
                    hostCommand('start_game');
                  }}
                  className="btn-primary mt-4 w-full !rounded-xl sm:w-auto"
                >
                  {playerCount === 0
                    ? 'Waiting for the first player'
                    : `Start with ${playerCount} ${playerCount === 1 ? 'player' : 'players'}`}
                </button>
              </motion.div>
            ) : (
              <motion.div
                key={`round-${hostRound?.roundIndex}`}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
                className="flex flex-col gap-4"
              >
                {hostRound && (
                  <NowPlaying
                    round={hostRound}
                    revealing={!!roundEnd}
                    revealEndsAt={roundEnd?.revealEndsAt ?? null}
                    paused={paused}
                  />
                )}
                {hostRound?.previewUrl && hostOnly && (
                  <SyncedAudio
                    previewUrl={hostRound.previewUrl}
                    playAt={hostRound.playAt}
                    playbackSeconds={hostRound.playbackSeconds}
                    paused={paused}
                    stopped={audioStopped}
                    onFailed={() => setAudioFailed(hostRound.roundIndex)}
                  />
                )}
                {audioFailed === hostRound?.roundIndex && (
                  <p role="alert" className="text-sm text-amber-100">
                    This song would not load on this device. Skip it, or check your connection.
                  </p>
                )}
                {/* A host who chose to play answers here, from the same screen as the controls. */}
                {event.hostPlays && game.round?.options && !roundEnd && (
                  <MultipleChoiceGuess
                    options={game.round.options}
                    onGuess={(song) => game.submitGuess(String(song.id))}
                    onSkip={() => game.submitGuess('__pass__')}
                    lockedGuessId={game.lastGuess?.guessedTrackId ?? null}
                    disabled={!!game.lastGuess || paused}
                    dense
                    twoColumn
                  />
                )}
                <AnsweredBar store={game.scoresStore} total={playerCount} />
                <div className="flex flex-wrap gap-2">
                  <ControlButton
                    primary
                    onClick={() => hostCommand(paused ? 'host_resume' : 'host_pause')}
                  >
                    {paused ? 'Resume' : 'Pause'}
                  </ControlButton>
                  <ControlButton onClick={() => hostCommand('host_skip')}>
                    {roundEnd ? 'Next round' : 'Skip song'}
                  </ControlButton>
                  <ControlButton
                    onClick={() => hostCommand('host_stop_audio')}
                    disabled={audioStopped}
                  >
                    {audioStopped ? 'Music stopped' : 'Stop music'}
                  </ControlButton>
                  {confirmEnd ? (
                    <>
                      <ControlButton danger onClick={() => hostCommand('host_end')}>
                        Yes, end it for everyone
                      </ControlButton>
                      <ControlButton onClick={() => setConfirmEnd(false)}>Keep going</ControlButton>
                    </>
                  ) : (
                    <ControlButton onClick={() => setConfirmEnd(true)}>End event</ControlButton>
                  )}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        {phase !== 'lobby' && phase !== 'starting' && (
          <LiveScoreboard
            store={game.scoresStore}
            selfId={game.selfId}
            limit={10}
            title="Top 10"
            showMedals={phase === 'finished'}
          />
        )}
      </div>

      <aside className="flex flex-col gap-5">
        <div className="glass rounded-2xl p-4">
          <SharePanel code={event.code} eventName={event.name} needsPassword={event.hasPassword} />
        </div>
        {room && room.players.length > 0 && phase !== 'finished' && (
          <div className="glass rounded-2xl p-4">
            <h2 className="mb-2 text-sm font-semibold text-white">Just joined</h2>
            <ul className="flex flex-col gap-1">
              {[...room.players]
                .reverse()
                .slice(0, 8)
                .map((p) => (
                  <li
                    key={p.playerId}
                    className="flex items-center justify-between gap-2 text-sm text-slate-300"
                  >
                    <span className="min-w-0 truncate">{p.displayName}</span>
                    <button
                      type="button"
                      onClick={() => {
                        if (
                          window.confirm(
                            `Remove ${p.displayName} from the event? They cannot rejoin.`,
                          )
                        ) {
                          hostCommand('host_kick', { playerId: p.playerId });
                        }
                      }}
                      className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
                    >
                      Remove
                    </button>
                  </li>
                ))}
            </ul>
          </div>
        )}
      </aside>
    </div>
  );
}

function PlayerCount({ count }: { count: number }) {
  const reduced = useReducedMotion();
  return (
    <span className="inline-flex items-baseline gap-1">
      <motion.span
        key={count}
        initial={reduced ? false : { opacity: 0.4, y: 3 }}
        animate={{ opacity: 1, y: 0 }}
        className="font-semibold tabular-nums text-white"
      >
        {count}
      </motion.span>
      {count === 1 ? 'player' : 'players'}
    </span>
  );
}

function NowPlaying({
  round,
  revealing,
  revealEndsAt,
  paused,
}: {
  round: HostRound;
  revealing: boolean;
  revealEndsAt: number | null;
  paused: boolean;
}) {
  const left = useCountdownTo(revealing ? revealEndsAt : round.roundEndsAt);
  return (
    <div className="flex items-center gap-3.5">
      {round.albumArtUrl ? (
        <img
          src={round.albumArtUrl}
          alt=""
          width={64}
          height={64}
          className="h-16 w-16 shrink-0 rounded-xl object-cover"
        />
      ) : (
        <span className="h-16 w-16 shrink-0 rounded-xl bg-white/10" />
      )}
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-400">
          Song {round.roundIndex + 1} of {round.totalRounds}
        </p>
        <p className="truncate font-bold text-white">{round.title}</p>
        <p className="truncate text-sm text-slate-400">{round.artist}</p>
      </div>
      <p className="shrink-0 text-right">
        <span className="block text-2xl font-bold tabular-nums text-white">
          {paused ? '❚❚' : left}
        </span>
        <span className="text-xs text-slate-400">
          {paused ? 'Paused' : revealing ? 'to next song' : 'to answer'}
        </span>
      </p>
    </div>
  );
}

function AnsweredBar({
  store,
  total,
}: {
  store: ReturnType<typeof useMultiplayerGame>['scoresStore'];
  total: number;
}) {
  const answered = useScores(store, (s) => s.answeredCount ?? 0);
  const fraction = total ? Math.min(1, answered / total) : 0;
  return (
    <div>
      <p className="mb-1 text-xs tabular-nums text-slate-400">
        {answered} of {total} answered
      </p>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
        <motion.div
          className="h-full origin-left rounded-full bg-chorusify-accent2"
          animate={{ scaleX: fraction }}
          initial={false}
          transition={{ duration: 0.3, ease: 'easeOut' }}
        />
      </div>
    </div>
  );
}

function ControlButton({
  primary,
  danger,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      {...props}
      className={`!rounded-xl !px-4 !py-2 !text-sm ${
        primary
          ? 'btn-primary'
          : danger
            ? 'btn-secondary !border-red-400/50 !text-red-200'
            : 'btn-secondary'
      }`}
    />
  );
}
