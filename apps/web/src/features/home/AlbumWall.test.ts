import { describe, expect, it, vi } from 'vitest';
import type { SamplerSong } from '../../api/songs';

vi.mock('../../api/songs', () => ({ getSampler: vi.fn() }));
const { buildColumns } = await import('./AlbumWall');

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
});
