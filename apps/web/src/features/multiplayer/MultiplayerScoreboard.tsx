import { memo, useEffect, useRef } from 'react';
import { animate, AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import type { MultiplayerScoreEntry } from '../../types/api';
import { useGameConfig } from '../../hooks/useGameConfig';
import type { MultiplayerStanding } from './useMultiplayerGame';
import { useScores, type ScoresStore } from './scoresStore';

interface MultiplayerScoreboardProps {
  scores: MultiplayerScoreEntry[];
  selfId: string | null;
  hostId?: string | null;
  /** Shows whether each player has answered (and correctly) for the current round. */
  showRoundState?: boolean;
  /**
   * Medals for the top three instead of plain rank numbers.
   *
   * Off everywhere except the final standings on purpose: in the lobby nobody has played yet,
   * and mid-game the order is still moving, so a gold medal beside a name reads as a result
   * when it is only a snapshot.
   */
  showMedals?: boolean;
  /** Your place across the whole room, drawn under the list when it falls outside the top ten. */
  standing?: MultiplayerStanding | null;
  /** Rows to draw before cutting off. Unset in the lobby, where the board is the guest list. */
  limit?: number;
  title?: string;
}

const MEDALS = ['🥇', '🥈', '🥉'] as const;

/* Warm metals against the dark surface. Distinct at a glance on a projector, at any row height. */
const PODIUM = [
  { chip: 'bg-amber-300 text-amber-950', row: 'bg-amber-300/[0.09]' },
  { chip: 'bg-slate-300 text-slate-900', row: 'bg-slate-300/[0.07]' },
  { chip: 'bg-orange-400 text-orange-950', row: 'bg-orange-400/[0.08]' },
] as const;

/**
 * The rows to draw, plus your own standing when you are not among them.
 *
 * The server already caps the scores frame at ten, but a room snapshot after a reconnect carries
 * everyone, so the cut happens here too. A standing that puts you inside the cut while the rows
 * disagree is a frame out of step; showing nothing beats showing a contradiction.
 */
export function topStandings(
  scores: MultiplayerScoreEntry[],
  selfId: string | null,
  standing: MultiplayerStanding | null | undefined,
  limit = Infinity,
): { rows: MultiplayerScoreEntry[]; selfOutside: MultiplayerStanding | null } {
  const rows = scores.slice(0, limit);
  const listed = rows.some((r) => r.playerId === selfId);
  return { rows, selfOutside: !listed && standing && standing.rank > limit ? standing : null };
}

/* Firm and unbouncy: rows trading places should read as a re-sort, not a toy. MotionConfig in
   App.tsx turns layout motion off for anyone who asked the OS for reduced motion. */
const REORDER = { type: 'spring', stiffness: 420, damping: 38 } as const;

/** A stable colour from a name, so someone stays recognisable as they move up the board. */
export function avatarHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i += 1) h = (Math.imul(31, h) + name.charCodeAt(i)) | 0;
  return (h >>> 0) % 360;
}

export function Avatar({ name, size = 28 }: { name: string; size?: number }) {
  const hue = avatarHue(name);
  return (
    <span
      aria-hidden="true"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.42,
        backgroundColor: `hsl(${hue} 55% 28%)`,
        color: `hsl(${hue} 85% 88%)`,
      }}
      className="flex shrink-0 items-center justify-center rounded-full font-semibold uppercase"
    >
      {name.trim().charAt(0) || '?'}
    </span>
  );
}

/** Counts to the new total by writing the text node directly, so a score change costs no render. */
function AnimatedScore({ value }: { value: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const shown = useRef(value);
  const reduced = useReducedMotion();
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (reduced || shown.current === value) {
      shown.current = value;
      node.textContent = String(value);
      return;
    }
    const controls = animate(shown.current, value, {
      duration: 0.7,
      ease: [0.16, 1, 0.3, 1],
      onUpdate: (v) => {
        shown.current = v;
        node.textContent = String(Math.round(v));
      },
    });
    return () => controls.stop();
  }, [value, reduced]);
  return (
    <span
      ref={ref}
      className="min-w-[4ch] text-right text-sm font-semibold tabular-nums text-white"
    >
      {value}
    </span>
  );
}

const ScoreRow = memo(function ScoreRow({
  player,
  place,
  isYou,
  isHost,
  showRoundState,
  showMedals,
  maxGuesses,
}: {
  player: MultiplayerScoreEntry;
  place: number;
  isYou: boolean;
  isHost: boolean;
  showRoundState: boolean;
  showMedals: boolean;
  maxGuesses: number;
}) {
  const podium = player.score > 0 || showMedals ? PODIUM[place - 1] : undefined;
  return (
    <motion.li
      layout="position"
      transition={REORDER}
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0 }}
      aria-current={isYou || undefined}
      className={`flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 sm:py-2 ${
        isYou ? 'bg-white/10 ring-1 ring-white/20' : (podium?.row ?? 'bg-white/[0.03]')
      }`}
    >
      {showMedals && MEDALS[place - 1] ? (
        <span className="w-6 text-center text-sm">{MEDALS[place - 1]}</span>
      ) : (
        <span
          className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular-nums ${
            podium?.chip ?? 'text-slate-400'
          }`}
        >
          {place}
        </span>
      )}
      <Avatar name={player.displayName} />
      <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
        {player.displayName}
        {isYou && (
          <span className="ml-2 text-[10px] font-semibold uppercase text-chorusify-accent2">
            you
          </span>
        )}
        {isHost && (
          <span className="ml-1.5" title="Host">
            👑
          </span>
        )}
      </span>
      {showRoundState && (
        <span className="w-8 text-right font-mono text-xs">
          {/*
            Three states, not two. While a round is running the server withholds the
            outcome, so `correctThisRound` is null for everyone who has answered -
            treating that as falsy printed ✗ against them, telling the whole room they
            got it wrong before anybody knew.
          */}
          {!player.answered ? (
            <span className="text-slate-500" title="Reveal stage">
              {player.stageIndex + 1}/{maxGuesses}
            </span>
          ) : player.correctThisRound == null ? (
            <span className="text-chorusify-accent2" title="Locked in">
              🔒
            </span>
          ) : player.correctThisRound ? (
            <span className="text-emerald-400">✓</span>
          ) : (
            <span className="text-red-400">✗</span>
          )}
        </span>
      )}
      <AnimatedScore value={player.score} />
    </motion.li>
  );
});

export const MultiplayerScoreboard = memo(function MultiplayerScoreboard({
  scores,
  selfId,
  hostId,
  showRoundState = false,
  showMedals = false,
  standing,
  limit,
  title = 'Scoreboard',
}: MultiplayerScoreboardProps) {
  const { maxGuesses } = useGameConfig();
  const { rows, selfOutside } = topStandings(scores, selfId, standing, limit);

  return (
    <div className="glass w-full rounded-2xl p-3 sm:p-4">
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-400">
        {title}
      </h3>
      <ul className="flex flex-col gap-1 sm:gap-1.5">
        {scores.length === 0 && (
          <li className="text-sm text-slate-400">No players yet.</li>
        )}
        <AnimatePresence initial={false}>
          {rows.map((player, i) => (
            <ScoreRow
              key={player.playerId}
              player={player}
              place={player.rank ?? i + 1}
              isYou={player.playerId === selfId}
              isHost={player.playerId === hostId}
              showRoundState={showRoundState}
              showMedals={showMedals}
              maxGuesses={maxGuesses}
            />
          ))}
        </AnimatePresence>
        {/* The dashed rule stands for the rows in between, so a big rank does not read as
            eleventh. */}
        {selfOutside && (
          <li className="mt-1 border-t border-dashed border-white/10 pt-2" aria-current>
            <div className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-1.5 ring-1 ring-white/20 sm:py-2">
              <span className="min-w-6 text-center text-xs font-semibold tabular-nums text-slate-300">
                {selfOutside.rank}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                You
                <span className="ml-2 font-normal text-slate-400">
                  of {selfOutside.totalPlayers}
                </span>
              </span>
              <span className="min-w-[4ch] text-right text-sm font-semibold tabular-nums text-white">
                {selfOutside.score}
              </span>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
});

/** The board as a live subscriber: only this re-renders when a scores frame lands. */
export function LiveScoreboard({
  store,
  ...props
}: Omit<MultiplayerScoreboardProps, 'scores'> & { store: ScoresStore }) {
  const rows = useScores(store, (s) => s.rows);
  return <MultiplayerScoreboard scores={rows} {...props} />;
}
