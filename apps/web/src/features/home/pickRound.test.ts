import { describe, expect, it } from 'vitest';
import type { SamplerSong } from '../../api/songs';
import { pickRound } from './pickRound';

const song = (id: number, dailyEdition: 'english' | 'desi'): SamplerSong => ({
  id,
  title: `Song ${id}`,
  artist: 'A',
  albumArtUrl: null,
  dailyEdition,
});
const songs = [1, 2, 3, 4, 5].map((n) => song(n, 'english')).concat(song(6, 'desi'));

describe('pickRound', () => {
  it('offers four different songs including the answer, from one edition', () => {
    for (let i = 0; i < 5; i += 1) {
      const round = pickRound(songs, i)!;
      expect(new Set(round.choices.map((c) => c.id)).size).toBe(4);
      expect(round.choices).toContain(round.answer);
      expect(round.choices.every((c) => c.dailyEdition === 'english')).toBe(true);
    }
  });
  it('gives up rather than offering too few choices', () => {
    expect(pickRound(songs, 5)).toBeNull();
    expect(pickRound([], 0)).toBeNull();
  });
});
