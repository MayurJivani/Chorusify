import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams, Link, useLocation } from 'react-router-dom';
import { searchArtistTracks } from '../api/artists';
import { searchCategoryTracks } from '../api/categories';
import { useMultiplayerGame } from '../features/multiplayer/useMultiplayerGame';
import { MultiplayerLobby } from '../features/multiplayer/MultiplayerLobby';
import { MultiplayerGame } from '../features/multiplayer/MultiplayerGame';
import { MultiplayerResults } from '../features/multiplayer/MultiplayerResults';
import { usePageTitle } from '../hooks/usePageTitle';
import { useSession } from '../hooks/useSession';
import { ensureMediaUnlocked } from '../features/game/SnippetPlayer';
import { VinylSpinner } from '../features/easter-eggs/VinylSpinner';
import { AvatarPicker } from '../features/multiplayer/AvatarPicker';
import {
  hasSavedAvatar,
  saveAvatar,
  savedAvatar,
  type AvatarId,
} from '../features/multiplayer/avatars';
import { getEventJoinInfo } from '../api/events';
import type { EventJoinInfo } from '../types/api';

export function MultiplayerRoomPage() {
  usePageTitle('Game Room');

  const { code: codeParam } = useParams<{ code: string }>();
  const code = (codeParam ?? '').toUpperCase();
  const navigate = useNavigate();
  const location = useLocation();
  const { user, loading: sessionLoading } = useSession();
  const autoJoin = location.state?.autoJoin === true;
  const hostName = typeof location.state?.hostName === 'string' ? location.state.hostName : '';
  const [name, setName] = useState('');
  const [nickname, setNickname] = useState<string | null>(autoJoin ? hostName : null);
  const [nameError, setNameError] = useState<string | null>(null);
  const [avatar, setAvatar] = useState<AvatarId>(savedAvatar);
  const [password, setPassword] = useState('');
  const [submittedPassword, setSubmittedPassword] = useState('');
  const [eventInfo, setEventInfo] = useState<EventJoinInfo | null>(null);

  // Scanning a QR lands here. An event shows its name and asks for its password up front;
  // an ordinary room has no stored record, and this comes back empty.
  useEffect(() => {
    getEventJoinInfo(code).then(
      (r) => setEventInfo(r.event),
      () => setEventInfo(null),
    );
  }, [code]);

  /**
   * A signed-in player joins straight through: the server resolves their display name from
   * their account when no nickname is sent, so the prompt would only be a chance to disagree
   * with the name already on their profile. Waits for the session to load first — deciding
   * while `user` is still null would show the form to someone who is in fact logged in.
   */
  const skipNamePrompt =
    !sessionLoading &&
    user !== null &&
    nickname === null &&
    !eventInfo?.needsPassword &&
    hasSavedAvatar();
  useEffect(() => {
    if (!skipNamePrompt) return;
    ensureMediaUnlocked();
    setNickname('');
  }, [skipNamePrompt]);

  const {
    connectionStatus,
    room,
    selfId,
    round,
    stageIndex,
    roundEnd,
    gameOver,
    scoresStore,
    paused,
    audioStopped,
    closedReason,
    errorCode,
    lastGuess,
    standing,
    error,
    startGame,
    reveal,
    submitGuess,
    nextRound,
    changeSource,
    leave,
    hostCommand,
  } = useMultiplayerGame(code, nickname, {
    password: submittedPassword,
    avatar,
  });

  // Back to the form with the reason. An account's own name is changed on the profile page instead.
  useEffect(() => {
    if ((errorCode === 'name_required' || errorCode === 'name_rejected') && !user) {
      setNameError(error);
      setNickname(null);
    }
  }, [errorCode, error, user]);

  // The typeahead has to search whatever the room races over, not always an artist.
  const sourceType = room?.sourceType;
  const sourceId = room?.sourceId;
  const searchRoomTracks = useCallback(
    (query: string) => {
      if (!sourceId) return Promise.resolve([]);
      return sourceType === 'category'
        ? searchCategoryTracks(sourceId, query)
        : searchArtistTracks(Number(sourceId), query, false);
    },
    [sourceType, sourceId],
  );

  const handleLeave = useCallback(() => {
    leave();
    navigate('/multiplayer');
  }, [leave, navigate]);

  // Pre-join: ask for a name (optional) before opening the socket. Signed-in players never see
  // this — the effect above joins them straight through under their account name.
  if (nickname === null) {
    if (sessionLoading || skipNamePrompt) {
      return (
        <Centered>
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-chorusify-accent2" />
        </Centered>
      );
    }
    return (
      <Centered>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            ensureMediaUnlocked();
            setSubmittedPassword(password);
            saveAvatar(avatar);
            setNickname(user ? '' : name.trim());
          }}
          className="glass flex w-full max-w-md flex-col items-center gap-4 rounded-2xl p-6 text-center"
        >
          <div className="flex flex-col items-center gap-1">
            {eventInfo ? (
              <>
                <h1 className="text-2xl font-extrabold text-white">{eventInfo.name}</h1>
                {eventInfo.description && (
                  <p className="text-sm text-slate-400">{eventInfo.description}</p>
                )}
                <p className="mt-1 font-mono text-sm tracking-widest text-chorusify-accent2">
                  {code}
                </p>
              </>
            ) : (
              <>
                <p className="text-sm text-slate-400">You&apos;re joining room</p>
                <p className="font-mono text-3xl font-black tracking-[0.25em] text-chorusify-accent2">
                  {code}
                </p>
              </>
            )}
          </div>
          {eventInfo?.status === 'ended' ? (
            <p className="text-sm text-slate-300">This event has finished.</p>
          ) : (
            <>
              {!user && (
                <input
                  autoFocus
                  required
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  maxLength={24}
                  placeholder="Your name"
                  aria-label="Your name"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white outline-none placeholder:text-slate-500 focus:border-chorusify-accent2"
                />
              )}
              <AvatarPicker
                value={avatar}
                onChange={(id) => {
                  setAvatar(id);
                  saveAvatar(id);
                }}
              />
              {nameError && (
                <p role="alert" className="text-sm text-red-300">
                  {nameError}
                </p>
              )}
              {eventInfo?.needsPassword && (
                <input
                  required
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  maxLength={100}
                  placeholder="Event password"
                  aria-label="Event password"
                  autoComplete="off"
                  className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white outline-none placeholder:text-slate-500 focus:border-chorusify-accent2"
                />
              )}
              <button
                type="submit"
                disabled={!user && !name.trim()}
                className="btn-primary w-full !rounded-xl"
              >
                {eventInfo ? 'Join event →' : 'Join room →'}
              </button>
            </>
          )}
        </form>
      </Centered>
    );
  }

  // A wrong password returns here with the socket held open for another try.
  if (errorCode === 'password_required' || errorCode === 'wrong_password') {
    return (
      <Centered>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            hostCommand('join_room', { code, password, nickname: nickname ?? undefined });
          }}
          className="glass flex w-full max-w-md flex-col items-center gap-4 rounded-2xl p-6 text-center"
        >
          <h1 className="text-lg font-bold text-white">
            {eventInfo?.name ?? 'This event'} needs a password
          </h1>
          {errorCode === 'wrong_password' && (
            <p role="alert" className="text-sm text-red-300">
              That password is not right. Ask the host.
            </p>
          )}
          <input
            autoFocus
            required
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            maxLength={100}
            aria-label="Event password"
            autoComplete="off"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-center text-sm text-white outline-none focus:border-chorusify-accent2"
          />
          <button type="submit" className="btn-primary w-full !rounded-xl">
            Join event →
          </button>
        </form>
      </Centered>
    );
  }

  if (closedReason) {
    return (
      <Centered>
        <div className="glass flex max-w-md flex-col items-center gap-4 rounded-2xl p-6 text-center">
          <h1 className="text-lg font-bold text-white">You&apos;re out of this game</h1>
          <p className="text-sm text-slate-400">{closedReason}</p>
          <Link to="/multiplayer" className="btn-primary w-full !rounded-xl">
            Back to multiplayer
          </Link>
        </div>
      </Centered>
    );
  }

  // The server only lets you into an ordinary room while it's in the lobby — a dropped socket during
  // the game means you're out, so show that honestly instead of a broken spinner. Events keep your
  // seat and carry on reconnecting.
  if (connectionStatus === 'closed' && room && room.phase !== 'lobby' && !room.event) {
    return (
      <Centered>
        <div className="glass flex max-w-md flex-col items-center gap-4 rounded-2xl p-6 text-center">
          <p className="text-2xl">📡</p>
          <h1 className="text-lg font-bold text-white">Lost connection</h1>
          <p className="text-sm text-slate-400">
            The game was already in progress, so the server couldn&apos;t put you back in the room.
            Spectate-free for now.
          </p>
          <Link to="/multiplayer" className="btn-primary w-full !rounded-xl">
            Back to multiplayer
          </Link>
        </div>
      </Centered>
    );
  }

  if (gameOver && room) {
    return (
      <MultiplayerResults
        gameOver={gameOver}
        selfId={selfId}
        label={room.label}
        canPlayAgain={selfId === room.hostId && !room.event}
        isEvent={!!room.event}
        onPlayAgain={startGame}
        onChangeSource={changeSource}
        onLeave={handleLeave}
      />
    );
  }

  if (round && room && (connectionStatus !== 'closed' || room.event)) {
    return (
      <MultiplayerGame
        room={room}
        selfId={selfId}
        round={round}
        stageIndex={stageIndex}
        roundEnd={roundEnd}
        scoresStore={scoresStore}
        paused={paused}
        audioStopped={audioStopped}
        reconnecting={connectionStatus !== 'open'}
        lastGuess={lastGuess}
        standing={standing}
        searchFn={searchRoomTracks}
        onSubmitGuess={submitGuess}
        onReveal={reveal}
        onNextRound={nextRound}
        onLeave={handleLeave}
      />
    );
  }

  // Shown to everyone, not just the host: the wait belongs to the room, and a lobby that looks
  // untouched after the host presses start reads as a dead button. That is what made hosts press
  // it twice and pay for the catalogue build twice.
  if (room && room.phase === 'starting' && connectionStatus !== 'closed') {
    return (
      <Centered>
        <div className="flex flex-col items-center gap-4 text-center">
          <VinylSpinner size={72} text="" />
          <div>
            <p className="font-bold text-white">Starting {room.label}…</p>
            <p className="mt-1 text-sm text-slate-400">
              Lining up the songs. The first game on a new category takes longer.
            </p>
          </div>
        </div>
      </Centered>
    );
  }

  if (room && connectionStatus !== 'closed') {
    return (
      <MultiplayerLobby room={room} selfId={selfId} onStart={startGame} onLeave={handleLeave} />
    );
  }

  if (error) {
    return (
      <Centered>
        <div className="glass flex max-w-md flex-col items-center gap-4 rounded-2xl p-6 text-center">
          <p className="text-2xl">🤔</p>
          <h1 className="text-lg font-bold text-white">Can&apos;t join this room</h1>
          <p className="text-sm text-slate-400">{error}</p>
          <Link to="/multiplayer" className="btn-primary w-full !rounded-xl">
            Back to multiplayer
          </Link>
        </div>
      </Centered>
    );
  }

  return (
    <Centered>
      <div className="flex flex-col items-center gap-3 text-slate-400">
        <span className="h-6 w-6 animate-spin rounded-full border-2 border-white/20 border-t-chorusify-accent2" />
        <p className="font-mono text-sm">Joining room {code}…</p>
      </div>
    </Centered>
  );
}

function Centered({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full items-center justify-center px-4">{children}</div>;
}
