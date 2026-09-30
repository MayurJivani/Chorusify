import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import confetti from 'canvas-confetti';
import type { MultiplayerGameOver } from './useMultiplayerGame';
import { MultiplayerScoreboard } from './MultiplayerScoreboard';
import { SongPreviewButton } from '../game/SongPreviewButton';
import { SourcePicker, type PickedSource } from './SourcePicker';
import { buildRoomShareText } from '../stats/shareText';
import { shareOrCopy } from '../stats/shareOrCopy';

interface MultiplayerResultsProps {
  gameOver: MultiplayerGameOver;
  selfId: string | null;
  label: string;
  canPlayAgain: boolean;
  onPlayAgain: () => void;
  /** Host-only: races something else without breaking up the room. */
  onChangeSource: (source: { artistId: number } | { categoryId: string }) => void;
  onLeave: () => void;
}

export function MultiplayerResults({
  gameOver,
  selfId,
  label,
  canPlayAgain,
  onPlayAgain,
  onChangeSource,
  onLeave,
}: MultiplayerResultsProps) {
  const iWon = gameOver.winner?.playerId === selfId;
  const [picking, setPicking] = useState(false);
  const [showSongs, setShowSongs] = useState(false);
  const [picked, setPicked] = useState<PickedSource | null>(null);
  const [shared, setShared] = useState(false);

  useEffect(() => {
    if (!iWon) return;
    void confetti({
      particleCount: 160,
      spread: 90,
      origin: { y: 0.3 },
      colors: ['#7c5cff', '#22d3ee', '#22c55e'],
    });
  }, [iWon]);

  const handleShare = async () => {
    const ok = await shareOrCopy(
      buildRoomShareText({
        subject: label,
        standings: gameOver.scores,
        selfName: gameOver.scores.find((s) => s.playerId === selfId)?.displayName,
        url: 'https://chorusify.com',
      }),
    );
    if (!ok) return;
    setShared(true);
    setTimeout(() => setShared(false), 2000);
  };

  const confirmSource = () => {
    if (!picked) return;
    onChangeSource(
      picked.kind === 'artist'
        ? { artistId: picked.artist.id }
        : picked.kind === 'soundtrack'
          ? { categoryId: picked.collection.id }
          : { categoryId: picked.category.id },
    );
    setPicking(false);
    setPicked(null);
  };

  return (
    <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center gap-4 sm:gap-6 px-4 py-4 sm:py-8">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass flex w-full flex-col items-center gap-4 rounded-2xl p-4 sm:p-6 text-center"
      >
        <h1 className="text-2xl font-extrabold text-white">Game over!</h1>
        {gameOver.winner ? (
          <div className="flex flex-col items-center gap-1">
            <p className="text-4xl">👑</p>
            <p className="text-xl font-bold text-chorusify-accent2">
              {gameOver.winner.displayName}
            </p>
            <p className="text-sm text-slate-400">
              wins the {label} race with {gameOver.winner.score} points
            </p>
            {iWon && <p className="text-sm font-semibold text-emerald-400">That&apos;s you! 🎉</p>}
          </div>
        ) : (
          <p className="text-sm text-slate-400">No players finished.</p>
        )}
      </motion.div>

      <MultiplayerScoreboard
        scores={gameOver.scores}
        selfId={selfId}
        showMedals
        title="Final standings"
      />

      {/*
        The set list.
        A round is a couple of seconds of audio and then it is gone, and the songs worth hearing
        are usually the ones nobody got. Ending on a scoreboard alone throws away the half of
        the game people actually want to talk about.
      */}
      {gameOver.songs.length > 0 && (
        <section className="glass w-full rounded-2xl border border-white/10 p-4">
          {/*
            Collapsed by default. At twenty-five rounds the set list pushed the scoreboard and
            the "play again" controls off the screen entirely, so the thing everyone wants to
            look at first was below the thing they wanted to browse afterwards.
          */}
          <button
            type="button"
            onClick={() => setShowSongs((v) => !v)}
            aria-expanded={showSongs}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400">
              What you played
              <span className="ml-1.5 font-normal normal-case tracking-normal text-slate-500">
                ({gameOver.songs.length})
              </span>
            </h2>
            <span
              aria-hidden="true"
              className={`text-slate-400 transition-transform duration-200 ${showSongs ? 'rotate-180' : ''}`}
            >
              ▾
            </span>
          </button>
          <ul className={`mt-2 flex-col gap-1.5 ${showSongs ? 'flex' : 'hidden'}`}>
            {gameOver.songs.map((song, index) => (
              <li
                key={`${song.title}-${index}`}
                className="flex items-center gap-3 rounded-xl border border-white/5 bg-white/[0.02] p-2"
              >
                <span className="w-4 shrink-0 text-right font-mono text-[11px] text-slate-500">
                  {index + 1}
                </span>
                {song.albumArtUrl ? (
                  <img
                    src={song.albumArtUrl}
                    alt=""
                    className="h-9 w-9 shrink-0 rounded-lg object-cover ring-1 ring-white/10"
                  />
                ) : (
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/10 text-sm">
                    🎵
                  </div>
                )}
                <div className="min-w-0 flex-1 text-left">
                  <p className="truncate text-sm font-semibold text-white">{song.title}</p>
                  <p className="truncate text-[11px] text-slate-400">{song.artist}</p>
                </div>
                {song.previewUrl && (
                  <div className="shrink-0">
                    <SongPreviewButton previewUrl={song.previewUrl} />
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="flex w-full max-w-xl flex-col gap-3">
        {/*
          Offered to everyone, not just the host. A finished room is the one result in the game
          with an audience already assembled, and until now there was no way for any of them to
          post it.
        */}
        <button
          type="button"
          onClick={handleShare}
          className="btn-secondary w-full !rounded-xl"
          aria-live="polite"
        >
          {shared ? 'Copied ✓' : 'Share the standings'}
        </button>

        {canPlayAgain && !picking && (
          <>
            <button type="button" onClick={onPlayAgain} className="btn-primary w-full !rounded-xl">
              Play again ({label})
            </button>
            <button
              type="button"
              onClick={() => setPicking(true)}
              className="btn-secondary w-full !rounded-xl"
            >
              Race something else
            </button>
          </>
        )}

        {/*
          The catalogue is shown to the whole room once the game is over, not just the host.
          Deciding what to play next is the conversation people are having at that moment, and
          only the host being able to see the options meant everyone else was arguing about a
          list they could not read. Non-hosts browse it; only the host's picks do anything.
        */}
        {(picking || !canPlayAgain) && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass flex w-full flex-col gap-3 rounded-2xl p-4"
          >
            <p className="text-sm font-semibold text-white">
              {canPlayAgain ? 'Pick the next artist or category' : "What's next?"}
            </p>
            <p className="text-xs text-slate-400">
              {canPlayAgain
                ? 'Everyone stays in the room - scores reset for the new race.'
                : 'Browse while the host decides. Shout if you see something good.'}
            </p>
            <SourcePicker value={picked} onChange={setPicked} compact />
            {canPlayAgain && (
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setPicking(false);
                    setPicked(null);
                  }}
                  className="btn-ghost flex-1 !rounded-xl !py-2.5 !text-sm"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={confirmSource}
                  disabled={!picked}
                  className="btn-primary flex-1 !rounded-xl !py-2.5 !text-sm"
                >
                  Switch
                </button>
              </div>
            )}
            {!canPlayAgain && picked && (
              <p className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-xs text-slate-300">
                Like the look of{' '}
                <span className="font-semibold text-white">
                  {picked.kind === 'artist'
                    ? picked.artist.name
                    : picked.kind === 'soundtrack'
                      ? picked.collection.label
                      : picked.category.label}
                </span>
                ? Only the host can start it.
              </p>
            )}
          </motion.div>
        )}

        <button type="button" onClick={onLeave} className="btn-ghost w-full !rounded-xl">
          Leave room
        </button>
      </div>
    </div>
  );
}
