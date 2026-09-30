import type { GuessAttempt } from '../game/useGameState';
import { MAX_GUESSES } from '../../types/api';

/** `maxGuesses` is a parameter because it is an admin setting, not a constant — the pip row has
 *  to be as long as the schedule actually in force. Defaults to the shipped six. */
export function buildShareText(
  history: GuessAttempt[],
  won: boolean,
  puzzleDate: string,
  maxGuesses: number = MAX_GUESSES,
): string {
  const pips = Array.from({ length: maxGuesses }, (_, i) => {
    const attempt = history[i];
    if (!attempt) return '⬛'; // unused slot
    return attempt.correct ? '🟩' : '🟥';
  }).join('');

  const score = won ? `${history.length}/${maxGuesses}` : `X/${maxGuesses}`;

  return `Chorusify ${puzzleDate} 🎵 ${score}\n${pips}`;
}

/**
 * A run's result as a shareable grid.
 *
 * Wordle's emoji grid is the whole reason that game spread: it shows off a result without
 * spoiling the answer, and it renders identically everywhere text does. This is the same idea
 * for a multi-song run — one square per song, so the shape of the run is legible at a glance.
 */
export function buildRunShareText(input: {
  /** "Queen", "Top Hits 2024" — what the run was drawn from. */
  subject: string;
  history: boolean[];
  songsCorrect: number;
  totalRounds: number;
  timeTakenSeconds?: number | null;
  /** Included so a reader can play the same challenge, not just admire the grid. */
  url?: string;
}): string {
  // Padded to the full length: an abandoned or in-flight run should still read as "out of ten"
  // rather than silently shrinking to however many songs were answered.
  const squares = Array.from({ length: input.totalRounds }, (_, i) => {
    const answered = input.history[i];
    if (answered === undefined) return '⬛';
    return answered ? '🟩' : '🟥';
  });

  // Ten per line keeps the grid a sensible width once runs get long.
  const grid = squares
    .reduce<string[][]>((rows, square, i) => {
      if (i % 10 === 0) rows.push([]);
      rows[rows.length - 1]!.push(square);
      return rows;
    }, [])
    .map((row) => row.join(''))
    .join('\n');

  const time =
    input.timeTakenSeconds != null ? ` · ${formatShareDuration(input.timeTakenSeconds)}` : '';

  return [
    `Chorusify · ${input.subject} 🎵 ${input.songsCorrect}/${input.totalRounds}${time}`,
    grid,
    ...(input.url ? [input.url] : []),
  ].join('\n');
}

/** A survival run: the number is the whole story, so the grid would only dilute it. */
export function buildSurvivalShareText(streak: number, url?: string): string {
  const flames = streak === 0 ? '💀' : '🔥'.repeat(Math.min(5, Math.ceil(streak / 5)));
  return [`Chorusify Survival ${flames} ${streak} in a row`, ...(url ? [url] : [])].join('\n');
}

function formatShareDuration(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s}s` : `${s}s`;
}

/**
 * A finished room's scoreboard.
 *
 * The one result in the game with a built-in audience: everyone in the room just played it, and
 * up to now there was no way to post it. Ranked lines rather than an emoji grid because the
 * story of a race is the standings, not one player's accuracy.
 *
 * No song titles, same as every other share here - a scoreboard that spoils the set list stops
 * the person reading it from playing the same room.
 */
export function buildRoomShareText(input: {
  /** "Queen", "Rock Essentials" - what the room raced over. */
  subject: string;
  standings: { displayName: string; score: number }[];
  /** Highlighted in the list, so a reader can see how the sharer did. */
  selfName?: string;
  url?: string;
}): string {
  // Three medals then plain numbers; a 100-player room would otherwise be unpostable.
  const MEDALS = ['🥇', '🥈', '🥉'];
  const lines = input.standings.slice(0, 10).map((player, i) => {
    const marker = MEDALS[i] ?? `${i + 1}.`;
    const you = player.displayName === input.selfName ? ' ←' : '';
    return `${marker} ${player.displayName} ${player.score}${you}`;
  });

  const others = input.standings.length - lines.length;
  if (others > 0) lines.push(`+${others} more`);

  return [
    `Chorusify · ${input.subject} 🎵 ${input.standings.length} players`,
    ...lines,
    ...(input.url ? [input.url] : []),
  ].join('\n');
}
