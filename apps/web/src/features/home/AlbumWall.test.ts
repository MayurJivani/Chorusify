import { describe, expect, it } from 'vitest';
import type { SamplerSong } from '../../api/songs';
import { buildWall, cellPosition, flipTile, uniqueCovers, wallGrid } from './AlbumWall';

const song = (id: number, art: string): SamplerSong => ({
  id,
  title: `Song ${id}`,
  artist: 'A',
  albumArtUrl: art,
  dailyEdition: 'english',
});

describe('buildWall', () => {
  it('shows every cover before repeating, one per album', () => {
    expect(buildWall([], 10)).toEqual([]);
    const covers = uniqueCovers([song(1, 'x'), song(2, 'x'), song(3, 'y')]);
    expect(covers.map((s) => s.id)).toEqual([2, 3]);
    const wall = buildWall(
      Array.from({ length: 40 }, (_, i) => song(i, `art-${i}`)),
      66,
    );
    expect(new Set(wall.slice(0, 40).map((s) => s.id)).size).toBe(40);
  });
});

describe('flipTile', () => {
  it('flips a cell to a cover that is not on the wall yet', () => {
    const covers = Array.from({ length: 120 }, (_, i) => song(i, `art-${i}`));
    const wall = buildWall(covers, 66);
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

describe('the drifting grid', () => {
  it('has a spare cell on every side of the wall', () => {
    for (const [w, h] of [
      [375, 300],
      [1440, 900],
      [800, 600],
    ] as const) {
      const g = wallGrid(w, h);
      expect((g.cols - 1) * g.step).toBeGreaterThanOrEqual(w);
      expect((g.rows - 1) * g.step).toBeGreaterThanOrEqual(h);
    }
  });
  it('wraps every cell round, so the wall stays covered however far it drifts', () => {
    const { cols, rows, step } = wallGrid(1440, 900);
    for (const offset of [
      { x: 0, y: 0 },
      { x: -12345.6, y: -789.1 },
      { x: 999, y: 4321 },
    ]) {
      const xs = new Set<number>();
      for (let i = 0; i < cols * rows; i += 1) {
        const { x, y } = cellPosition(i, cols, rows, step, offset);
        expect(x).toBeGreaterThanOrEqual(-step);
        expect(x).toBeLessThan((cols - 1) * step);
        expect(y).toBeGreaterThanOrEqual(-step);
        expect(y).toBeLessThan((rows - 1) * step);
        xs.add(Math.round(x));
      }
      // Still one column per slot: no two columns pile up on the same spot.
      expect(xs.size).toBe(cols);
    }
  });
});
