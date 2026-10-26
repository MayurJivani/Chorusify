import { describe, expect, it } from 'vitest';
import { topStandings } from './MultiplayerScoreboard';
import type { MultiplayerScoreEntry } from '../../types/api';

const row = (n: number): MultiplayerScoreEntry => ({
  playerId: `p${n}`,
  displayName: `P${n}`,
  score: 100 - n,
  totalAnswerMs: 0,
  answered: false,
  correctThisRound: null,
  stageIndex: 0,
});
const twelve = Array.from({ length: 12 }, (_, i) => row(i + 1));

describe('topStandings', () => {
  it('cuts to ten and adds your standing when you are below them', () => {
    const out = topStandings(twelve, 'p12', { rank: 12, score: 88, totalPlayers: 12 }, 10);
    expect(out.rows.map((r) => r.playerId)).toEqual(twelve.slice(0, 10).map((r) => r.playerId));
    expect(out.selfOutside).toEqual({ rank: 12, score: 88, totalPlayers: 12 });
  });

  it('adds nothing when you are already on the board', () => {
    expect(
      topStandings(twelve, 'p3', { rank: 3, score: 97, totalPlayers: 12 }, 10).selfOutside,
    ).toBeNull();
  });

  it('ignores a standing that contradicts the rows or has not arrived', () => {
    expect(
      topStandings(twelve, 'p12', { rank: 4, score: 0, totalPlayers: 12 }, 10).selfOutside,
    ).toBeNull();
    expect(topStandings(twelve, 'p12', null, 10).selfOutside).toBeNull();
  });

  it('draws everyone when no limit is set, as the lobby needs', () => {
    expect(topStandings(twelve, 'p12', null).rows).toHaveLength(12);
  });
});
