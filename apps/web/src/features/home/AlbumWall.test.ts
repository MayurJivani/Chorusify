import { describe, expect, it } from 'vitest';
import type { SamplerSong } from '../../api/songs';
import { buildColumns, tileFilter, wanderTarget } from './AlbumWall';

const song = (id: number, art: string): SamplerSong => ({
  id,
  title: `Song ${id}`,
  artist: 'A',
  albumArtUrl: art,
  dailyEdition: 'english',
});

describe('buildColumns', () => {
  it('shows each cover once per column and offsets neighbours', () => {
    const songs = Array.from({ length: 40 }, (_, i) => song(i, `art-${i}`));
    const columns = buildColumns(songs);
    expect(new Set(columns[0]!.map((s) => s.id)).size).toBe(columns[0]!.length);
    expect(columns[0]![0]!.id).not.toBe(columns[1]![0]!.id);
  });
  it('drops songs that share a cover, and copes with few or none', () => {
    expect(buildColumns([])).toEqual([]);
    const columns = buildColumns([song(1, 'x'), song(2, 'x')]);
    expect(new Set(columns.flat().map((s) => s.albumArtUrl)).size).toBe(1);
  });
  it('shows every cover before repeating once there are enough to fill the wall', () => {
    const songs = Array.from({ length: 200 }, (_, i) => song(i, `art-${i}`));
    const shown = buildColumns(songs)
      .flat()
      .map((s) => s.id);
    expect(new Set(shown).size).toBe(200);
  });
});

describe('tileFilter', () => {
  it('is full colour at the pointer and full grey out of reach', () => {
    expect(tileFilter(0)).toBe('none');
    expect(tileFilter(500)).toBe('grayscale(1) brightness(0.35)');
  });
  it('fades in between, so nearby covers show some colour', () => {
    expect(tileFilter(90)).toBe('none');
    expect(tileFilter(170)).toBe('grayscale(0.5) brightness(0.65)');
  });
});

describe('wanderTarget', () => {
  it('stays inside the visible band of the wall', () => {
    for (const r of [0, 0.5, 0.999]) {
      const { x, y } = wanderTarget(1000, 800, () => r);
      expect(x).toBeGreaterThanOrEqual(120);
      expect(x).toBeLessThanOrEqual(880);
      expect(y).toBeGreaterThanOrEqual(176);
      expect(y).toBeLessThanOrEqual(496);
    }
  });
});
