import { useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { getHostedEvent, listPlaylists } from '../api/events';
import { MultipleChoiceGuess } from '../features/artist/MultipleChoiceGuess';
import { SharePanel } from '../features/events/SharePanel';
import { SyncedAudio } from '../features/events/SyncedAudio';
import { Disc } from '../features/game/Disc';
import { Avatar, LiveScoreboard } from '../features/multiplayer/MultiplayerScoreboard';
import { useScores } from '../features/multiplayer/scoresStore';
import { useCountdownTo } from '../features/multiplayer/useCountdownTo';
import { useMultiplayerGame, type HostRound } from '../features/multiplayer/useMultiplayerGame';
import { usePageTitle } from '../hooks/usePageTitle';
import { ensureMediaUnlocked } from '../features/game/SnippetPlayer';
import type { HostedEvent, Playlist } from '../types/api';

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
  // Off when a TV screen is the speaker, so the room does not hear the song twice.
  const [musicHere, setMusicHere] = useState(true);
  const [volume, setVolume] = useState(1);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [nextPlaylistId, setNextPlaylistId] = useState('');
  const screenUrl = `${window.location.origin}/screen/${event.code}?key=${event.screenKey}`;

  useEffect(() => {
    listPlaylists().then(
      (r) => setPlaylists(r.playlists.filter((p) => p.tracks.filter((t) => !t.trial).length >= 4)),
      () => undefined,
    );
  }, []);

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
                <div className="mt-4 flex flex-wrap items-center gap-2">
                  <label className="sr-only" htmlFor="next-playlist">
                    Next playlist
                  </label>
                  <select
                    id="next-playlist"
                    value={nextPlaylistId}
                    onChange={(e) => setNextPlaylistId(e.target.value)}
                    className="event-input w-auto min-w-0 flex-1"
                  >
                    <option value="">Play another playlist…</option>
                    {playlists.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({p.tracks.filter((t) => !t.trial).length} songs
                        {p.tracks.some((t) => t.trial) ? ' + trial' : ''})
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!nextPlaylistId}
                    onClick={() => {
                      hostCommand('host_next_playlist', { playlistId: nextPlaylistId });
                      setNextPlaylistId('');
                    }}
                    className="btn-primary !rounded-xl !py-2 !text-sm"
                  >
                    Load it, keep everyone
                  </button>
                  <Link to="/events" className="btn-ghost !rounded-xl !py-2 !text-sm">
                    Back to events
                  </Link>
                </div>
              </motion.div>
            ) : !inRound ? (
              <motion.div key="lobby" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <h2 className="text-lg font-bold text-white">
                  {phase === 'starting'
                    ? 'Starting…'
                    : room?.trialDone
                      ? 'Trial over. Every score is back to 0'
                      : 'Waiting for players'}
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
                    : `${room?.trialPending ? 'Play the trial song' : room?.trialDone ? 'Start the main event' : 'Start'} with ${playerCount} ${playerCount === 1 ? 'player' : 'players'}`}
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
                    trial={!!room?.isTrial}
                  />
                )}
                {room?.isTrial && (
                  <div className="flex flex-wrap items-center gap-3 rounded-xl bg-amber-400/10 p-3">
                    <p className="min-w-0 flex-1 text-sm text-amber-100">
                      Trial song. Nobody keeps these points.
                    </p>
                    <button
                      type="button"
                      onClick={() => hostCommand('start_game')}
                      className="btn-primary !rounded-xl !py-2 !text-sm"
                    >
                      Start the main event
                    </button>
                  </div>
                )}
                {hostOnly && (
                  <label className="flex items-center gap-2 text-sm text-slate-300">
                    <input
                      type="checkbox"
                      checked={musicHere}
                      onChange={(e) => setMusicHere(e.target.checked)}
                      className="h-4 w-4 accent-white"
                    />
                    Play the music on this device (turn off if the TV screen is the speaker)
                  </label>
                )}
                {hostRound?.previewUrl && hostOnly && musicHere && (
                  <SyncedAudio
                    previewUrl={hostRound.previewUrl}
                    playAt={hostRound.playAt}
                    playbackSeconds={hostRound.playbackSeconds}
                    paused={paused}
                    stopped={audioStopped}
                    volume={volume}
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
                {hostOnly && musicHere && (
                  <label className="flex items-center gap-3 text-sm text-slate-300">
                    Volume
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={volume}
                      onChange={(e) => setVolume(Number(e.target.value))}
                      className="w-40 accent-white"
                    />
                  </label>
                )}
                {roundEnd?.answers && hostRound?.options && (
                  <AnswerSplit
                    options={hostRound.options}
                    answers={roundEnd.answers}
                    correctTitle={roundEnd.correct?.title ?? ''}
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
                  {!roundEnd && (
                    <>
                      <ControlButton onClick={() => hostCommand('host_extend', { seconds: 10 })}>
                        +10 seconds
                      </ControlButton>
                      <ControlButton onClick={() => hostCommand('host_reveal')}>
                        Reveal now
                      </ControlButton>
                    </>
                  )}
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
        <div className="glass rounded-2xl p-4">
          <h2 className="text-sm font-semibold text-white">TV or projector</h2>
          <p className="mt-1 text-xs text-slate-400">
            Open this on the big screen: the QR to join, the question, the countdown and the top 10,
            with the music. Keep the link to yourself, it works without logging in.
          </p>
          <div className="mt-3 flex gap-2">
            <a
              href={screenUrl}
              target="_blank"
              rel="noreferrer"
              className="btn-primary flex-1 !rounded-xl !px-3 !py-2 text-center !text-sm"
            >
              Open screen
            </a>
            <button
              type="button"
              onClick={() => void navigator.clipboard?.writeText(screenUrl).catch(() => undefined)}
              className="btn-secondary flex-1 !rounded-xl !px-3 !py-2 !text-sm"
            >
              Copy link
            </button>
          </div>
        </div>
        <PlayersPanel
          locked={!!room?.locked}
          onLock={(locked) => hostCommand('host_lock', { locked })}
          onSearch={(q) => hostCommand('host_players', { q })}
          results={game.hostPlayers}
          newest={room ? [...room.players].reverse().slice(0, 8) : []}
          onKick={(playerId) => hostCommand('host_kick', { playerId })}
          total={playerCount}
        />
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
  trial,
}: {
  round: HostRound;
  revealing: boolean;
  revealEndsAt: number | null;
  paused: boolean;
  trial: boolean;
}) {
  const left = useCountdownTo(revealing ? revealEndsAt : round.roundEndsAt);
  return (
    <div className="flex items-center gap-3.5">
      <Disc
        size={72}
        art={round.albumArtUrl}
        spinning={!revealing && !paused}
        arm
        className="mr-5"
      />
      <div className="min-w-0 flex-1">
        <p className="text-xs text-slate-400">
          {trial
            ? 'Trial song · points do not count'
            : `Song ${round.roundIndex + 1} of ${round.totalRounds}`}
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

/** Who chose what, at the reveal. The right answer's bar is the green one. */
function AnswerSplit({
  options,
  answers,
  correctTitle,
}: {
  options: { deezerTrackId: string; title: string }[];
  answers: Record<string, number>;
  correctTitle: string;
}) {
  const total = Object.values(answers).reduce((a, b) => a + b, 0);
  return (
    <ul className="flex flex-col gap-1.5" aria-label="How the room answered">
      {options.map((o) => {
        const n = answers[o.deezerTrackId] ?? 0;
        const right = o.title === correctTitle;
        return (
          <li key={o.deezerTrackId} className="text-sm">
            <div className="flex justify-between gap-2 text-slate-300">
              <span className="min-w-0 break-words">{o.title}</span>
              <span className="tabular-nums">{total ? Math.round((n / total) * 100) : 0}%</span>
            </div>
            <div className="mt-0.5 h-1.5 overflow-hidden rounded-full bg-white/10">
              <motion.div
                className={`h-full origin-left rounded-full ${right ? 'bg-emerald-400' : 'bg-white/35'}`}
                initial={{ scaleX: 0 }}
                animate={{ scaleX: total ? n / total : 0 }}
                transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
              />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** Lock entry, find anyone in a room of hundreds, and remove them. */
function PlayersPanel({
  locked,
  onLock,
  onSearch,
  results,
  newest,
  onKick,
  total,
}: {
  locked: boolean;
  onLock: (locked: boolean) => void;
  onSearch: (q: string) => void;
  results:
    | {
        playerId: string;
        displayName: string;
        avatar: string | null;
        score: number;
        connected: boolean;
      }[]
    | null;
  newest: { playerId: string; displayName: string; avatar?: string | null }[];
  onKick: (playerId: string) => void;
  total: number;
}) {
  const [q, setQ] = useState('');
  // A ref, so the console re-rendering every second does not keep restarting the debounce.
  const search = useRef(onSearch);
  search.current = onSearch;
  useEffect(() => {
    if (!q.trim()) return;
    const t = setTimeout(() => search.current(q), 250);
    return () => clearTimeout(t);
  }, [q]);
  const rows = q.trim() && results ? results : newest;
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-white">
          Players <span className="font-normal tabular-nums text-slate-400">{total}</span>
        </h2>
        <label className="flex items-center gap-2 text-xs text-slate-300">
          <input
            type="checkbox"
            checked={locked}
            onChange={(e) => onLock(e.target.checked)}
            className="h-4 w-4 accent-white"
          />
          Close entry
        </label>
      </div>
      <input
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Find a player"
        aria-label="Find a player"
        className="event-input mt-3"
      />
      <ul className="mt-2 flex max-h-72 flex-col gap-1 overflow-y-auto">
        {rows.map((p) => (
          <li key={p.playerId} className="flex items-center gap-2 text-sm text-slate-300">
            <Avatar name={p.displayName} avatar={p.avatar} size={22} />
            <span className="min-w-0 flex-1 truncate">{p.displayName}</span>
            {'score' in p && (
              <span className="tabular-nums text-xs text-slate-400">
                {(p as { score: number }).score}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                if (window.confirm(`Remove ${p.displayName} from the event? They cannot rejoin.`)) {
                  onKick(p.playerId);
                  if (q.trim()) onSearch(q);
                }
              }}
              className="shrink-0 rounded px-1.5 py-0.5 text-xs text-slate-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              Remove
            </button>
          </li>
        ))}
        {rows.length === 0 && (
          <li className="text-xs text-slate-400">
            {q.trim() ? 'Nobody by that name.' : 'Nobody yet.'}
          </li>
        )}
      </ul>
    </div>
  );
}
