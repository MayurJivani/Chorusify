import { useEffect, useMemo, useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeCanvas } from 'qrcode.react';
import { SyncedAudio } from '../features/events/SyncedAudio';
import { Disc, LabelCount } from '../features/game/Disc';
import { Avatar } from '../features/multiplayer/MultiplayerScoreboard';
import { useScores } from '../features/multiplayer/scoresStore';
import { useCountdownTo } from '../features/multiplayer/useCountdownTo';
import { useMultiplayerGame } from '../features/multiplayer/useMultiplayerGame';
import { ensureMediaUnlocked } from '../features/game/SnippetPlayer';
import { usePageTitle } from '../hooks/usePageTitle';
import type { MultiplayerScoreEntry } from '../types/api';

const TILE = [
  'bg-violet-500/20 ring-violet-400/40',
  'bg-cyan-500/20 ring-cyan-400/40',
  'bg-amber-500/20 ring-amber-400/40',
  'bg-emerald-500/20 ring-emerald-400/40',
];
const PODIUM = [
  'bg-amber-300 text-amber-950',
  'bg-slate-300 text-slate-900',
  'bg-orange-400 text-orange-950',
];
const EASE = [0.16, 1, 0.3, 1] as const;

/**
 * The big screen for a hosted event: what a hall watches on the projector. It never answers, and
 * plays the music when its sound is on. Sized in viewport units so it reads from the back row.
 */
export function ScreenPage() {
  usePageTitle('Event screen');
  const { code = '' } = useParams<{ code: string }>();
  const [params] = useSearchParams();
  const [started, setStarted] = useState(false);
  const [sound, setSound] = useState(true);
  const game = useMultiplayerGame(started ? code.toUpperCase() : '', started ? '' : null, {
    watchKey: params.get('key') ?? '',
  });
  const { room, round, roundEnd, gameOver, paused, audioStopped, scoresStore, connectionStatus } =
    game;

  if (!started) {
    return (
      <Shell>
        <div className="flex flex-col items-center gap-8 text-center">
          <Disc size="min(38vh, 60vw)" arm />
          <button
            type="button"
            onClick={() => {
              // The tap the browser needs before it will play sound, and a chance to fill the screen.
              ensureMediaUnlocked();
              void document.documentElement.requestFullscreen?.().catch(() => undefined);
              setStarted(true);
            }}
            className="btn-primary !rounded-2xl !px-10 !py-4 !text-[calc(2.2*var(--u))]"
          >
            Start the screen
          </button>
          <p className="text-[calc(1.8*var(--u))] text-slate-400">
            Connect this device to the speakers for the music.
          </p>
        </div>
      </Shell>
    );
  }

  if (game.errorCode === 'screen_refused' || game.closedReason) {
    return (
      <Shell>
        <p className="max-w-[60vw] text-center text-[calc(3*var(--u))] text-slate-200">
          {game.closedReason ??
            'This screen link is not valid. Copy it again from the host console.'}
        </p>
      </Shell>
    );
  }
  if (!room)
    return (
      <Shell>
        <Disc size="calc(30*var(--u))" spinning arm />
      </Shell>
    );

  const phase = gameOver ? 'finished' : room.phase;
  const count = room.playerCount ?? room.players.length;

  return (
    <Shell
      top={
        <header className="absolute inset-x-[3vw] top-[calc(3*var(--u))] flex items-center justify-between gap-4">
          <h1 className="truncate text-[calc(3.2*var(--u))] font-black tracking-tight text-white">
            {room.event?.name ?? room.label}
          </h1>
          <div className="flex items-center gap-4 text-[calc(1.9*var(--u))] text-slate-300">
            {connectionStatus !== 'open' && <span className="text-amber-300">Reconnecting…</span>}
            <span>
              <span className="font-bold tabular-nums text-white">{count}</span> playing
            </span>
            <button
              type="button"
              onClick={() => setSound((s) => !s)}
              className="rounded-full border border-white/15 px-4 py-1.5 text-[calc(1.7*var(--u))] text-slate-200 transition-colors hover:bg-white/10"
              aria-pressed={sound}
            >
              {sound ? 'Sound on' : 'Sound off'}
            </button>
          </div>
        </header>
      }
    >
      <AnimatePresence mode="wait">
        {phase === 'finished' && gameOver ? (
          <motion.div key="final" {...fade} className="w-full">
            <Podium scores={gameOver.scores} />
          </motion.div>
        ) : round && (phase === 'playing' || phase === 'round-reveal') ? (
          <motion.div
            key={`round-${round.roundIndex}-${roundEnd ? 'reveal' : 'play'}`}
            {...fade}
            className="grid w-full grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)] items-center gap-[4vw]"
          >
            {roundEnd ? (
              <Reveal
                share={rightShare(
                  roundEnd.answers,
                  round.options ?? [],
                  roundEnd.correct?.title ?? '',
                )}
                art={roundEnd.correct?.albumArtUrl ?? null}
                title={roundEnd.correct?.title ?? ''}
                artist={roundEnd.correct?.artist ?? ''}
                endsAt={roundEnd.revealEndsAt ?? null}
                index={round.roundIndex}
                total={round.totalRounds}
                trial={!!room.isTrial}
              />
            ) : (
              <Playing
                startedAt={round.startedAt}
                endsAt={round.startedAt + round.roundDurationMs}
                index={round.roundIndex}
                total={round.totalRounds}
                trial={!!room.isTrial}
                paused={paused}
                clipMs={(round.snippetSchedule[0] ?? 0) * 1000}
                stopped={audioStopped}
                store={scoresStore}
                players={count}
              />
            )}
            {roundEnd ? (
              <Board rows={roundEnd.scores} />
            ) : (
              <Options
                options={
                  round.options?.map((o) => ({
                    title: o.title,
                    artist: o.artist,
                    albumArtUrl: o.albumArtUrl,
                  })) ?? []
                }
              />
            )}
          </motion.div>
        ) : (
          <motion.div key="lobby" {...fade} className="w-full">
            <Lobby
              code={room.code}
              count={count}
              names={room.players.map((p) => ({
                id: p.playerId,
                name: p.displayName,
                avatar: p.avatar,
              }))}
              starting={phase === 'starting'}
              trialDone={!!room.trialDone}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {sound && round?.previewUrl && !roundEnd && (
        <SyncedAudio
          previewUrl={round.previewUrl}
          playAt={round.startedAt}
          playbackSeconds={round.snippetSchedule[0] ?? 15}
          paused={paused}
          stopped={audioStopped}
        />
      )}
      {paused && (
        <div className="absolute inset-x-0 bottom-[calc(5*var(--u))] text-center text-[calc(3*var(--u))] font-bold text-amber-200">
          Paused by the host
        </div>
      )}
    </Shell>
  );
}

const fade = {
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -10 },
  transition: { duration: 0.45, ease: EASE },
};

function Shell({ children, top }: { children: React.ReactNode; top?: React.ReactNode }) {
  return (
    // One unit for every size on the screen: a hundredth of the height, or less on a narrow display,
    // so a portrait tablet or a squarer projector does not overflow.
    <main
      style={{ ['--u' as string]: 'min(1vh, 0.62vw)' }}
      className="relative flex h-dvh w-full items-center justify-center overflow-hidden bg-chorusify-bg px-[4vw] py-[calc(11*var(--u))] text-white"
    >
      {/* One soft wash of colour behind everything, painted once. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_70%_55%_at_20%_15%,rgba(139,92,246,0.18),transparent_70%),radial-gradient(ellipse_60%_50%_at_85%_90%,rgba(6,182,212,0.12),transparent_70%)]"
      />
      {top}
      <div className="relative flex w-full items-center justify-center">{children}</div>
    </main>
  );
}

function Lobby({
  code,
  count,
  names,
  starting,
  trialDone,
}: {
  code: string;
  count: number;
  names: { id: string; name: string; avatar?: string | null }[];
  starting: boolean;
  trialDone: boolean;
}) {
  const joinUrl = `${window.location.origin}/room/${code}`;
  return (
    <div className="grid w-full grid-cols-[auto_minmax(0,1fr)] items-center gap-[5vw]">
      <div className="flex flex-col items-center gap-[calc(2*var(--u))]">
        <div className="rounded-[calc(2*var(--u))] bg-white p-[calc(1.6*var(--u))] shadow-2xl shadow-black/50">
          <QRCodeCanvas
            value={joinUrl}
            size={720}
            level="M"
            marginSize={1}
            style={{ width: 'calc(38*var(--u))', height: 'calc(38*var(--u))' }}
          />
        </div>
        <p className="text-[calc(2*var(--u))] text-slate-300">{window.location.host}/room</p>
        <p className="font-mono text-[calc(7*var(--u))] font-black leading-none tracking-[0.2em] text-chorusify-accent2">
          {code}
        </p>
      </div>
      <div className="flex min-w-0 flex-col items-start gap-[calc(3*var(--u))]">
        <p className="text-[calc(5.5*var(--u))] font-black leading-[1.05] tracking-tight">
          {starting ? 'Here we go…' : trialDone ? 'Trial over.' : 'Scan to join.'}
          <br />
          <span className={trialDone ? 'text-amber-200' : 'text-slate-400'}>
            {trialDone ? 'Points reset to 0. The real game is next.' : 'Name the song first.'}
          </span>
        </p>
        <Disc size="calc(24*var(--u))" spinning arm className="mr-[calc(8*var(--u))]">
          <LabelCount n={count} unit="players" unitOne="player" />
        </Disc>
        <ul
          className="flex max-h-[calc(18*var(--u))] flex-wrap gap-[calc(1*var(--u))] overflow-hidden"
          aria-label="Newest players"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {names.slice(-18).map((p) => (
              <motion.li
                key={p.id}
                layout
                initial={{ opacity: 0, scale: 0.6 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 460, damping: 28 }}
                className="flex items-center gap-[calc(0.8*var(--u))] rounded-full bg-white/[0.07] py-[calc(0.6*var(--u))] pl-[calc(0.6*var(--u))] pr-[calc(1.4*var(--u))] text-[calc(1.9*var(--u))] text-slate-100"
              >
                <Avatar name={p.name} avatar={p.avatar} size={28} />
                <span className="max-w-[16vw] truncate">{p.name}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      </div>
    </div>
  );
}

function Countdown({ to, label }: { to: number; label: string }) {
  const left = useCountdownTo(to);
  return (
    <p className="text-[calc(2.2*var(--u))] text-slate-300">
      <span className="text-[calc(6*var(--u))] font-black tabular-nums text-white">{left}</span>{' '}
      {label}
    </p>
  );
}

function Playing({
  startedAt,
  endsAt,
  index,
  total,
  paused,
  clipMs,
  stopped,
  store,
  players,
  trial,
}: {
  startedAt: number;
  endsAt: number;
  index: number;
  total: number;
  trial: boolean;
  paused: boolean;
  clipMs: number;
  stopped: boolean;
  store: ReturnType<typeof useMultiplayerGame>['scoresStore'];
  players: number;
}) {
  const now = useNow(startedAt, startedAt + clipMs);
  const before = now < startedAt;
  const playing = !before && now < startedAt + clipMs && !paused && !stopped;
  const answered = useScores(store, (s) => s.answeredCount ?? 0);
  return (
    <div className="flex flex-col items-center gap-[calc(3*var(--u))]">
      <p className="text-[calc(2.4*var(--u))] font-semibold uppercase tracking-[0.2em] text-slate-400">
        {trial ? (
          <span className="rounded-full bg-amber-400/15 px-[calc(2*var(--u))] py-[calc(0.6*var(--u))] text-amber-200">
            Trial song · points do not count
          </span>
        ) : (
          `Song ${index + 1} of ${total}`
        )}
      </p>
      <Disc size="calc(34*var(--u))" spinning={playing} arm className="mr-[calc(10*var(--u))]" />
      {before ? (
        <Countdown to={startedAt} label="get ready" />
      ) : (
        <Countdown to={endsAt} label="seconds to answer" />
      )}
      <div className="w-[70%]">
        <div className="h-[calc(1*var(--u))] overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full origin-left rounded-full bg-chorusify-accent2"
            animate={{ scaleX: players ? Math.min(1, answered / players) : 0 }}
            initial={false}
            transition={{ duration: 0.3 }}
          />
        </div>
        <p className="mt-[calc(1*var(--u))] text-center text-[calc(2*var(--u))] tabular-nums text-slate-300">
          {answered} of {players} answered
        </p>
      </div>
    </div>
  );
}

/** Re-renders at the two moments that change what is shown, not every frame. */
function useNow(...moments: number[]) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timers = moments.map((m) =>
      setTimeout(() => setNow(Date.now()), Math.max(0, m - Date.now()) + 20),
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, moments);
  return now;
}

function Options({
  options,
}: {
  options: { title: string; artist: string; albumArtUrl?: string | null }[];
}) {
  return (
    <div className="grid grid-cols-2 gap-[calc(2*var(--u))]">
      {options.map((o, i) => (
        <motion.div
          key={o.title + i}
          initial={{ opacity: 0, scale: 0.94 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: 0.08 * i, duration: 0.35, ease: EASE }}
          className={`flex min-h-[calc(16*var(--u))] items-center gap-[calc(2*var(--u))] rounded-[calc(2*var(--u))] p-[calc(2.4*var(--u))] ring-2 ${TILE[i]}`}
        >
          {o.albumArtUrl && (
            <img
              src={o.albumArtUrl}
              alt=""
              className="h-[calc(10*var(--u))] w-[calc(10*var(--u))] shrink-0 rounded-[calc(1*var(--u))] object-cover"
            />
          )}
          <span className="min-w-0">
            <span className="block break-words text-[calc(3*var(--u))] font-bold leading-tight text-white">
              {o.title}
            </span>
            <span className="block truncate text-[calc(2*var(--u))] text-slate-300">
              {o.artist}
            </span>
          </span>
        </motion.div>
      ))}
      <p className="col-span-2 text-center text-[calc(2*var(--u))] text-slate-400">
        Answer on your phone
      </p>
    </div>
  );
}

/** Of those who answered, the share who picked the right title. Null when nobody answered. */
function rightShare(
  answers: Record<string, number> | undefined,
  options: { deezerTrackId: string; title: string }[],
  title: string,
): number | null {
  const total = Object.values(answers ?? {}).reduce((a, b) => a + b, 0);
  const right = options.find((o) => o.title === title);
  return total && right ? Math.round(((answers?.[right.deezerTrackId] ?? 0) / total) * 100) : null;
}

function Reveal({
  share,
  art,
  title,
  artist,
  endsAt,
  index,
  total,
  trial,
}: {
  share: number | null;
  art: string | null;
  title: string;
  artist: string;
  endsAt: number | null;
  index: number;
  total: number;
  trial: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center gap-[calc(3*var(--u))] text-center">
      {art && <img src={art} alt="" className="reveal-glow" />}
      <p className="text-[calc(2.4*var(--u))] font-semibold uppercase tracking-[0.2em] text-slate-400">
        {trial ? 'The trial song was' : `Song ${index + 1} of ${total} was`}
      </p>
      <div className="relative h-[calc(30*var(--u))] w-[calc(30*var(--u))]">
        <motion.span
          className="absolute left-0 top-0"
          initial={{ x: 0, rotate: -50 }}
          animate={{ x: '42%', rotate: 0 }}
          transition={{ type: 'spring', stiffness: 150, damping: 20, delay: 0.15 }}
        >
          <Disc size="calc(30*var(--u))" art={art} />
        </motion.span>
        {art ? (
          <img
            src={art}
            alt=""
            className="absolute inset-0 h-full w-full rounded-[calc(1*var(--u))] object-cover shadow-2xl shadow-black/60 ring-1 ring-white/15"
          />
        ) : (
          <span className="absolute inset-0 rounded-[calc(1*var(--u))] bg-white/10" />
        )}
      </div>
      <div className="max-w-[40vw]">
        <p className="line-clamp-2 text-[calc(4.6*var(--u))] font-black leading-tight">{title}</p>
        <p className="mt-[calc(0.6*var(--u))] truncate text-[calc(2.6*var(--u))] text-slate-300">
          {artist}
        </p>
      </div>
      {share != null && (
        <p className="text-[calc(2.6*var(--u))] text-slate-200">
          <span className="font-black text-emerald-300">{share}%</span> got it right
        </p>
      )}
      {endsAt && <Countdown to={endsAt} label="to the next song" />}
    </div>
  );
}

function Board({ rows }: { rows: MultiplayerScoreEntry[] }) {
  return (
    <ol className="flex flex-col gap-[calc(1*var(--u))]">
      {rows.slice(0, 10).map((row, i) => {
        const place = row.rank ?? i + 1;
        return (
          <motion.li
            key={row.playerId}
            layout
            initial={{ opacity: 0, x: 24 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.35, ease: EASE }}
            className={`flex items-center gap-[calc(1.6*var(--u))] rounded-[calc(1.4*var(--u))] px-[calc(1.8*var(--u))] py-[calc(1*var(--u))] ${place <= 3 ? 'bg-white/[0.08]' : 'bg-white/[0.03]'}`}
          >
            <span
              className={`flex h-[calc(4.2*var(--u))] w-[calc(4.2*var(--u))] shrink-0 items-center justify-center rounded-full text-[calc(2.1*var(--u))] font-black tabular-nums ${PODIUM[place - 1] ?? 'text-slate-400'}`}
            >
              {place}
            </span>
            <Avatar name={row.displayName} avatar={row.avatar} size={34} />
            <span className="min-w-0 flex-1 truncate text-[calc(2.6*var(--u))] font-semibold">
              {row.displayName}
            </span>
            {row.correctThisRound && (
              <span className="text-[calc(2*var(--u))] text-emerald-400">✓</span>
            )}
            <span className="text-[calc(2.8*var(--u))] font-black tabular-nums">{row.score}</span>
          </motion.li>
        );
      })}
    </ol>
  );
}

function Podium({ scores }: { scores: MultiplayerScoreEntry[] }) {
  const [first, second, third] = scores;
  const rest = useMemo(() => scores.slice(3, 10), [scores]);
  const step = (
    row: MultiplayerScoreEntry | undefined,
    place: number,
    height: string,
    delay: number,
  ) =>
    row ? (
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay, type: 'spring', stiffness: 120, damping: 16 }}
        className="flex w-[22vw] flex-col items-center gap-[calc(1.4*var(--u))]"
      >
        {place === 1 ? (
          <Disc size="calc(18*var(--u))" spinning arm className="mr-[calc(5*var(--u))]">
            <Avatar name={row.displayName} avatar={row.avatar} size={64} />
          </Disc>
        ) : (
          <Avatar name={row.displayName} avatar={row.avatar} size={88} />
        )}
        <p className="max-w-full truncate text-[calc(3*var(--u))] font-black">{row.displayName}</p>
        <p className="text-[calc(2.4*var(--u))] tabular-nums text-slate-300">{row.score} pts</p>
        <div
          className={`flex w-full items-start justify-center rounded-t-[calc(1.6*var(--u))] pt-[calc(1.4*var(--u))] text-[calc(5*var(--u))] font-black ${PODIUM[place - 1]}`}
          style={{ height }}
        >
          {place}
        </div>
      </motion.div>
    ) : null;
  return (
    <div className="flex flex-col items-center gap-[calc(4*var(--u))]">
      <div className="flex items-end justify-center gap-[1.5vw]">
        {step(second, 2, 'calc(14*var(--u))', 0.5)}
        {step(first, 1, 'calc(20*var(--u))', 0.9)}
        {step(third, 3, 'calc(10*var(--u))', 0.2)}
      </div>
      {rest.length > 0 && (
        <ol className="grid grid-cols-2 gap-x-[4vw] gap-y-[calc(0.6*var(--u))] text-[calc(2.2*var(--u))] text-slate-300">
          {rest.map((row, i) => (
            <li key={row.playerId} className="flex justify-between gap-[3vw]">
              <span className="truncate">
                <span className="tabular-nums text-slate-500">{row.rank ?? i + 4}.</span>{' '}
                {row.displayName}
              </span>
              <span className="tabular-nums">{row.score}</span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
