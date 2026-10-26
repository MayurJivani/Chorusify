import { motion } from 'framer-motion';
import type { MultiplayerScoreEntry } from '../../types/api';
import { useGameConfig } from '../../hooks/useGameConfig';
import type { MultiplayerStanding } from './useMultiplayerGame';

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

export function MultiplayerScoreboard({
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
      <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-slate-500">
        {title}
      </h3>
      <ul className="flex flex-col gap-1 sm:gap-1.5">
        {scores.length === 0 && (
          <li className="text-sm text-slate-500">
            No players yet. Share the room code to invite friends!
          </li>
        )}
        {rows.map((player, i) => {
          const isYou = player.playerId === selfId;
          return (
            <motion.li
              key={player.playerId}
              layout="position"
              transition={REORDER}
              aria-current={isYou || undefined}
              className={`flex items-center gap-3 rounded-xl px-3 py-1.5 sm:py-2 ${
                isYou ? 'bg-white/10 ring-1 ring-white/20' : 'bg-white/[0.03]'
              }`}
            >
              <span className="w-6 text-center text-sm">
                {showMedals && MEDALS[i] ? (
                  MEDALS[i]
                ) : (
                  <span className="font-mono text-xs text-slate-400">{i + 1}</span>
                )}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                {player.displayName}
                {isYou && (
                  <span className="ml-2 text-[10px] font-semibold uppercase text-chorusify-accent2">
                    you
                  </span>
                )}
                {player.playerId === hostId && (
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
              <span className="min-w-[4ch] text-right font-mono text-sm font-semibold tabular-nums text-white">
                {player.score}
              </span>
            </motion.li>
          );
        })}
        {/* The dashed rule stands for the rows in between, so a big rank does not read as
            eleventh. */}
        {selfOutside && (
          <li className="mt-1 border-t border-dashed border-white/10 pt-2" aria-current>
            <div className="flex items-center gap-3 rounded-xl bg-white/10 px-3 py-1.5 ring-1 ring-white/20 sm:py-2">
              <span className="min-w-6 text-center font-mono text-xs tabular-nums text-slate-300">
                {selfOutside.rank}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-100">
                You
                <span className="ml-2 font-normal text-slate-400">
                  of {selfOutside.totalPlayers}
                </span>
              </span>
              <span className="min-w-[4ch] text-right font-mono text-sm font-semibold tabular-nums text-white">
                {selfOutside.score}
              </span>
            </div>
          </li>
        )}
      </ul>
    </div>
  );
}
