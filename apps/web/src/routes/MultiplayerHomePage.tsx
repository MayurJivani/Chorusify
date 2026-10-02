import { useCallback, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { motion } from 'framer-motion';
import { createMultiplayerRoom, MULTIPLAYER_MAX_ROUNDS } from '../api/multiplayer';
import { SourcePicker, type PickedSource } from '../features/multiplayer/SourcePicker';
import { QrScanner } from '../features/multiplayer/QrScanner';
import { KnockListenButton } from '../features/multiplayer/KnockListenButton';
import { MultiplayerGuide } from '../features/game/ModeGuide';
import type { MultiplayerGameMode, MultiplayerGuessMode } from '../types/api';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSession } from '../hooks/useSession';

/**
 * Classic (progressive reveal) is switched off while Speed Round is the only supported
 * multiplayer game. Mirrors MP_CLASSIC_ENABLED on the server — flip both to bring the mode
 * back; the selector below and every classic branch downstream are still intact.
 */
const CLASSIC_ENABLED = false;

/** Offered game lengths. Capped at the server's MP_MAX_ROUNDS. */
const ROUND_CHOICES = [5, 10, 15, 20, MULTIPLAYER_MAX_ROUNDS] as const;

export function MultiplayerHomePage() {
  usePageTitle('Multiplayer');
  const navigate = useNavigate();
  const { user } = useSession();

  const [source, setSource] = useState<PickedSource | null>(null);
  const [searchParams] = useSearchParams();
  const preselectSoundtrackId = searchParams.get('soundtrackId') ?? undefined;
  const [gameMode, setGameMode] = useState<MultiplayerGameMode>('speed');
  const [guessMode, setGuessMode] = useState<MultiplayerGuessMode>('search');
  const [rounds, setRounds] = useState<number>(10);
  const [hostOnlyAudio, setHostOnlyAudio] = useState(false);
  const [hostPlayable, setHostPlayable] = useState(true);
  const [hostName, setHostName] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [roomCode, setRoomCode] = useState('');
  const [scanning, setScanning] = useState(false);

  // A signed-in player already has a name on their account, so asking again is a pointless
  // extra field — and a second, conflicting name on the scoreboard when they type something new.
  const needsName = user === null;
  const canCreate = source !== null && (!needsName || hostName.trim().length > 0);

  const createRoom = useCallback(async () => {
    if (!source || creating) return;
    setCreating(true);
    setError(null);
    try {
      // Movie collections are category sources on the server, so a room is created the same
      // way; only the duel ladder distinguishes them. Several categories merge into one pool
      // via the same sorted "+"-joined id the solo Category picker uses.
      const payload =
        source.kind === 'artist'
          ? { artistId: source.artist.id }
          : source.kind === 'soundtrack'
            ? { categoryId: source.collection.id }
            : {
                categoryId: source.categories
                  .map((c) => c.id)
                  .sort()
                  .join('+'),
              };
      const { code } = await createMultiplayerRoom(
        payload,
        guessMode,
        gameMode,
        hostOnlyAudio,
        hostPlayable,
        rounds,
      );
      navigate(`/room/${code}`, { state: { autoJoin: true, hostName: hostName.trim() } });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create a room. Please try again.');
      setCreating(false);
    }
  }, [
    source,
    creating,
    guessMode,
    gameMode,
    hostOnlyAudio,
    hostPlayable,
    rounds,
    hostName,
    navigate,
  ]);

  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center gap-5 px-4 py-6 sm:py-10">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-1 text-center"
      >
        <h1 className="text-3xl font-extrabold tracking-tight text-white">Multiplayer</h1>
        <p className="text-sm text-slate-500">Race friends in real time on shared snippets</p>
      </motion.div>

      {/* Only before a source is chosen - see ArtistSearchPage for the same reasoning. */}
      {!source && <MultiplayerGuide />}

      <SourcePicker
        value={source}
        onChange={setSource}
        preselectSoundtrackId={preselectSoundtrackId}
        multiSelectCategories
      />

      {!source && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="glass w-full rounded-2xl p-6 flex flex-col gap-4"
        >
          <div>
            <h2 className="text-lg font-bold text-white">Join a room</h2>
            <p className="text-xs text-slate-400">
              Scan your friend&apos;s QR, or type their code.
            </p>
          </div>

          {scanning ? (
            <QrScanner
              onScan={(code) => {
                setScanning(false);
                navigate(`/room/${code}`);
              }}
              onClose={() => setScanning(false)}
            />
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (roomCode.trim()) {
                  navigate(`/room/${roomCode.trim().toUpperCase()}`);
                }
              }}
              className="flex w-full gap-2"
            >
              {/*
                Scan sits in the same row as the code field, because it is the alternative to
                typing one - as a separate full-width button underneath it read as a third,
                unrelated action and the typing stayed the obvious path.

                Always rendered, never feature-gated. Hiding it where `BarcodeDetector` is
                missing meant most people never learned scanning was an option at all; opening
                the panel and saying so plainly is better than silently offering less.
              */}
              <button
                type="button"
                onClick={() => setScanning(true)}
                aria-label="Scan a QR code to join"
                title="Scan a QR code"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl border border-chorusify-accent2/40 bg-chorusify-accent2/10 text-chorusify-accent2 transition-all duration-200 hover:border-chorusify-accent2/70 hover:bg-chorusify-accent2/20 active:scale-95"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  className="h-5 w-5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3.75 4.875c0-.621.504-1.125 1.125-1.125h3c.621 0 1.125.504 1.125 1.125v3c0 .621-.504 1.125-1.125 1.125h-3A1.125 1.125 0 0 1 3.75 7.875v-3Zm11.25 0c0-.621.504-1.125 1.125-1.125h3c.621 0 1.125.504 1.125 1.125v3c0 .621-.504 1.125-1.125 1.125h-3A1.125 1.125 0 0 1 15 7.875v-3ZM3.75 16.125c0-.621.504-1.125 1.125-1.125h3c.621 0 1.125.504 1.125 1.125v3c0 .621-.504 1.125-1.125 1.125h-3a1.125 1.125 0 0 1-1.125-1.125v-3Zm11.25 3v-3m0 0h2.25m-2.25 0h-.008m5.258 0H18m2.25 3v.008m0-3.008v-1.5m-5.25-1.5V15m0 0h1.5"
                  />
                </svg>
              </button>

              <input
                value={roomCode}
                onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                maxLength={12}
                placeholder="ROOM CODE"
                aria-label="Room code"
                /* min-w-0 is the fix: a flex item defaults to min-width:auto, so this input refused
                   to shrink below the width of its own "ROOM CODE" placeholder and shoved the button
                   off the screen on a narrow phone. */
                className="w-full min-w-0 flex-1 rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-center font-mono text-base font-black tracking-widest text-chorusify-accent2 outline-none focus:border-chorusify-accent2 uppercase placeholder:font-sans placeholder:tracking-normal placeholder:font-normal placeholder:text-slate-600"
              />
              <button
                type="submit"
                disabled={!roomCode.trim()}
                className="btn-primary shrink-0 !px-5 !py-2.5 !text-sm whitespace-nowrap"
              >
                Join
              </button>
            </form>
          )}

          {/*
            The third way in, after scanning and typing. Renders itself away unless an admin has
            turned the Beta on, so nobody is offered a microphone prompt for a feature the room
            is not using.
          */}
          {!scanning && <KnockListenButton onCode={(code) => navigate(`/room/${code}`)} />}
        </motion.div>
      )}

      {source && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass w-full rounded-2xl p-6"
        >
          <div className="flex items-center gap-4 rounded-xl border border-white/10 bg-white/5 p-3.5">
            {source.kind === 'artist' && source.artist.pictureUrl ? (
              <img
                src={source.artist.pictureUrl}
                alt={source.artist.name}
                className="h-12 w-12 shrink-0 rounded-full border border-white/20 object-cover"
              />
            ) : (
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-white/10 text-lg">
                ♪
              </div>
            )}
            <div className="min-w-0">
              <h2 className="truncate text-lg font-bold text-white">
                {source.kind === 'artist'
                  ? source.artist.name
                  : source.kind === 'soundtrack'
                    ? source.collection.label
                    : source.categories.map((c) => c.label).join(' + ')}
              </h2>
              <p className="text-xs text-slate-400">{rounds}-song real-time race</p>
            </div>
          </div>

          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Number of songs
            </p>
            <div className="grid grid-cols-5 gap-2">
              {ROUND_CHOICES.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setRounds(n)}
                  aria-pressed={rounds === n}
                  className={`rounded-xl border py-2.5 text-sm font-semibold transition-all ${
                    rounds === n
                      ? 'border-chorusify-accent/60 bg-chorusify-accent/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>

          {CLASSIC_ENABLED && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Game mode
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['classic', 'Classic', 'Progressive reveal, points by stage'],
                    ['speed', 'Speed Round', 'Full snippet, fastest correct = most points'],
                  ] as [MultiplayerGameMode, string, string][]
                ).map(([mode, label, hint]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGameMode(mode)}
                    aria-pressed={gameMode === mode}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                      gameMode === mode
                        ? 'border-chorusify-accent/60 bg-chorusify-accent/10 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-slate-400">
                      {hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {CLASSIC_ENABLED && gameMode === 'classic' && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                How does everyone guess?
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    ['search', 'Type to search', 'Search the full catalog'],
                    ['choice', 'Multiple choice', 'Pick one of four'],
                  ] as [MultiplayerGuessMode, string, string][]
                ).map(([mode, label, hint]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setGuessMode(mode)}
                    aria-pressed={guessMode === mode}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                      guessMode === mode
                        ? 'border-chorusify-accent/60 bg-chorusify-accent/10 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-slate-400">
                      {hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
              Audio playback
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  [false, 'Everyone', 'All players hear music on their device'],
                  [true, 'Host only', 'Only the host device plays music (for speakers)'],
                ] as [boolean, string, string][]
              ).map(([val, label, hint]) => (
                <button
                  key={String(val)}
                  type="button"
                  onClick={() => setHostOnlyAudio(val)}
                  aria-pressed={hostOnlyAudio === val}
                  className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                    hostOnlyAudio === val
                      ? 'border-chorusify-accent/60 bg-chorusify-accent/10 text-white'
                      : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                  }`}
                >
                  <span className="block text-sm font-semibold">{label}</span>
                  <span className="mt-0.5 block text-[11px] leading-tight text-slate-400">
                    {hint}
                  </span>
                </button>
              ))}
            </div>
          </div>

          {hostOnlyAudio && (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Host role
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    [true, 'Play + stream', 'Host guesses and plays music'],
                    [false, 'Stream only', "Host only plays music, doesn't guess"],
                  ] as [boolean, string, string][]
                ).map(([val, label, hint]) => (
                  <button
                    key={String(val)}
                    type="button"
                    onClick={() => setHostPlayable(val)}
                    aria-pressed={hostPlayable === val}
                    className={`rounded-xl border px-3 py-2.5 text-left transition-all ${
                      hostPlayable === val
                        ? 'border-chorusify-accent/60 bg-chorusify-accent/10 text-white'
                        : 'border-white/10 bg-white/[0.03] text-slate-300 hover:border-white/25'
                    }`}
                  >
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-0.5 block text-[11px] leading-tight text-slate-400">
                      {hint}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {needsName ? (
            <div className="mt-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-400">
                Your name
              </p>
              <input
                value={hostName}
                onChange={(e) => setHostName(e.target.value)}
                maxLength={24}
                placeholder="Enter your name"
                className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white outline-none placeholder:text-slate-600 focus:border-chorusify-accent2"
              />
            </div>
          ) : (
            <p className="mt-4 text-xs text-slate-400">
              Playing as <span className="font-semibold text-slate-200">{user.displayName}</span>
            </p>
          )}

          <button
            type="button"
            onClick={() => void createRoom()}
            disabled={creating || !canCreate}
            className="btn-primary mt-3 w-full !rounded-xl"
          >
            {creating ? 'Creating room…' : 'Create room →'}
          </button>

          {error && <p className="mt-3 text-sm text-chorusify-danger">{error}</p>}
        </motion.div>
      )}
    </div>
  );
}
