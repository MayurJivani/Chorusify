import { describe, expect, it } from 'vitest';
import type { SamplerSong } from '../../api/songs';
import { buildWall, flipTile, uniqueCovers, wanderPoint } from './AlbumWall';

const song = (id: number, art: string): SamplerSong => ({
  id,
  title: `Song ${id}`,
  artist: 'A',
  albumArtUrl: art,
  dailyEdition: 'english',
});

describe('buildWall', () => {
  it('shows every cover before repeating, one per album', () => {
    expect(buildWall([])).toEqual([]);
    const covers = uniqueCovers([song(1, 'x'), song(2, 'x'), song(3, 'y')]);
    expect(covers.map((s) => s.id)).toEqual([2, 3]);
    const wall = buildWall(Array.from({ length: 40 }, (_, i) => song(i, `art-${i}`)));
    expect(new Set(wall.slice(0, 40).map((s) => s.id)).size).toBe(40);
  });
});

describe('flipTile', () => {
  it('flips a cell to a cover that is not on the wall yet', () => {
    const covers = Array.from({ length: 120 }, (_, i) => song(i, `art-${i}`));
    const wall = buildWall(covers);
    const next = flipTile(wall, covers, 3, () => 0);
    expect(next[3]!.id).toBeGreaterThanOrEqual(wall.length);
    expect(next.filter((s, i) => s !== wall[i])).toHaveLength(1);
  });
  it('trades two cells when every cover is already up', () => {
    const covers = [song(1, 'a'), song(2, 'b'), song(3, 'c')];
    const next = flipTile(covers, covers, 0, () => 0);
    expect(next.map((s) => s.id)).toEqual([2, 1, 3]);
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
