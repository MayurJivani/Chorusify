import { describe, expect, it } from 'vitest';
import type { SamplerSong } from '../../api/songs';
import { buildColumns, tileFilter, wanderPoint } from './AlbumWall';

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
    expect(tileFilter(40)).toBe('none');
    expect(tileFilter(170)).toMatch(/^grayscale\(0\.[2-4]/);
  });
});

describe('wanderPoint', () => {
  it('stays inside the visible band of the wall', () => {
    for (let sec = 0; sec < 120; sec += 0.7) {
      const { x, y } = wanderPoint(sec, 1000, 800);
      expect(x).toBeGreaterThanOrEqual(200);
      expect(x).toBeLessThanOrEqual(800);
      expect(y).toBeGreaterThanOrEqual(176);
      expect(y).toBeLessThanOrEqual(496);
    }
  });
  it('moves slowly: under a tenth of the wall per second', () => {
    const a = wanderPoint(10, 1000, 800);
    const b = wanderPoint(11, 1000, 800);
    expect(Math.hypot(b.x - a.x, b.y - a.y)).toBeLessThan(100);
  });
});
