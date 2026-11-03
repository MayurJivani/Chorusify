import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { QRCodeSVG } from 'qrcode.react';
import type { MultiplayerRoomSnapshot, MultiplayerScoreEntry } from '../../types/api';
import { SharePanel } from '../events/SharePanel';
import { Disc } from '../game/Disc';
import { Avatar, MultiplayerScoreboard } from './MultiplayerScoreboard';
import { KnockAnnounceButton } from './KnockAnnounceButton';
import { ensureMediaUnlocked } from '../game/SnippetPlayer';

interface MultiplayerLobbyProps {
  room: MultiplayerRoomSnapshot;
  selfId: string | null;
  onStart: () => void;
  onLeave: () => void;
}

function toScoreEntries(room: MultiplayerRoomSnapshot): MultiplayerScoreEntry[] {
  return room.players.map((p) => ({
    playerId: p.playerId,
    displayName: p.displayName,
    score: p.score,
    // Lobby/snapshot rows have no answer times yet; the server fills these in once a round runs.
    totalAnswerMs: 0,
    answered: p.roundAnswered,
    correctThisRound: p.roundCorrect,
    stageIndex: p.stageIndex,
  }));
}

/** A hall of people arriving: the count is the news, and the newest few names keep it human. */
function EventLobby({ room, onLeave }: Pick<MultiplayerLobbyProps, 'room' | 'onLeave'>) {
  const count = room.playerCount ?? room.players.length;
  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-5 px-4 py-6 text-center">
      <h1 className="text-3xl font-extrabold text-white">{room.event?.name}</h1>
      {room.event?.description && (
        <p className="text-sm text-slate-400">{room.event.description}</p>
      )}
      <Disc size={190} spinning arm className="mr-10">
        <span className="text-3xl font-bold leading-none tabular-nums">{count}</span>
        <span className="text-[10px] font-medium opacity-90">
          {count === 1 ? 'player' : 'players'}
        </span>
      </Disc>
      <p className="text-sm text-slate-300">The host starts when everyone is ready.</p>
      <ul className="flex min-h-9 flex-wrap justify-center gap-1.5" aria-label="Newest players">
        <AnimatePresence initial={false} mode="popLayout">
          {room.players.slice(-12).map((p) => (
            <motion.li
              key={p.playerId}
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ type: 'spring', stiffness: 460, damping: 28 }}
              className="flex items-center gap-1.5 rounded-full bg-white/[0.06] py-1 pl-1 pr-2.5 text-xs text-slate-200"
            >
              <Avatar name={p.displayName} avatar={p.avatar} size={22} />
              <span className="max-w-24 truncate">{p.displayName}</span>
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
      <p className="text-sm text-slate-400">
        {room.event?.audioMode === 'host_only'
          ? 'The music comes through the speakers, so your phone stays quiet.'
          : 'The music plays on your phone. Turn your sound up.'}
      </p>
      <div className="glass w-full max-w-xs rounded-2xl p-4">
        <p className="mb-3 text-sm text-slate-300">Bring someone in</p>
        <SharePanel code={room.code} eventName={room.event?.name} />
      </div>
      <button
        type="button"
        onClick={onLeave}
        className="text-xs text-slate-400 underline decoration-dotted transition-colors hover:text-slate-200"
      >
        Leave event
      </button>
    </div>
  );
}

export function MultiplayerLobby({ room, selfId, onStart, onLeave }: MultiplayerLobbyProps) {
  const isHost = selfId === room.hostId;
  const [copied, setCopied] = useState(false);
  const inviteUrl = `${window.location.origin}/room/${room.code}`;

  const copyInvite = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(inviteUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  }, [inviteUrl]);

  if (room.event) return <EventLobby room={room} onLeave={onLeave} />;

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-4 sm:gap-6 px-4 py-4 sm:py-8">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass flex w-full flex-col items-center gap-4 rounded-2xl p-4 sm:p-6 text-center"
      >
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-2xl font-extrabold text-white">{room.label}</h1>
          <p className="text-sm text-slate-400">
            {room.gameMode === 'speed' ? 'Speed Round' : 'Classic'} ·{' '}
            <span className="text-slate-300">
              {room.guessMode === 'choice' ? 'Multiple choice' : 'Type to search'}
            </span>
          </p>
        </div>

        {/* The same record as an event lobby, its label counting the room in. */}
        <div className="flex w-full max-w-xs flex-col items-center gap-3">
          <Disc size={150} spinning arm className="mr-9">
            <span className="text-2xl font-bold leading-none tabular-nums">
              {room.players.length}
            </span>
            <span className="text-[9px] font-medium opacity-90">
              {room.players.length === 1 ? 'player' : 'players'}
            </span>
          </Disc>
          <p className="font-mono text-4xl font-black tracking-[0.3em] text-chorusify-accent2">
            {room.code}
          </p>
        </div>

        <div className="rounded-xl bg-white p-3">
          <QRCodeSVG value={inviteUrl} size={160} level="M" />
        </div>
        <p className="text-[11px] text-slate-500">Scan to join on another device</p>

        <button type="button" onClick={copyInvite} className="btn-primary w-full !rounded-xl">
          {copied ? '✓ Copied invite link!' : 'Copy invite link'}
        </button>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Waiting for players… ({room.players.length})
        </div>

        <div className="w-full">
          <MultiplayerScoreboard
            scores={toScoreEntries(room)}
            selfId={selfId}
            hostId={room.hostId}
          />
        </div>

        {/*
          Host Only rooms only. There the host device is already the room's speaker, so it is
          the one thing in the room that can announce the code; when every phone plays its own
          audio there is no single speaker, and several transmitting at once smear each other.
        */}
        {isHost && room.hostOnlyAudio && <KnockAnnounceButton code={room.code} />}

        {isHost ? (
          <button
            type="button"
            onClick={() => {
              ensureMediaUnlocked();
              onStart();
            }}
            className="btn-primary w-full !rounded-xl"
          >
            Start game →
          </button>
        ) : (
          <p className="text-sm text-slate-400">Waiting for the host to start…</p>
        )}

        {!isHost && room.players.length === 1 && (
          <p className="text-xs text-slate-500">You&apos;re first in. The host will start.</p>
        )}

        <button
          type="button"
          onClick={onLeave}
          className="btn-ghost w-full !rounded-xl !py-2 text-sm"
        >
          Leave room
        </button>
      </motion.div>
    </div>
  );
}
