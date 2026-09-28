import { describe, it, expect, vi } from 'vitest';

const catalogMocks = vi.hoisted(() => ({ getCategoryCatalog: vi.fn() }));
vi.mock('../../src/services/categoryCatalogService', () => catalogMocks);

import { resolveCategorySource } from '../../src/services/challengeSource';
import { CATEGORIES } from '../../src/services/categories';

const soundtrackId = CATEGORIES.find((c) => c.titles && c.titles.length > 0)!.id;

function track(id: string) {
  return {
    deezerTrackId: id,
    title: `Song ${id}`,
    artist: `Artist ${id}`,
    albumArtUrl: null,
    durationSeconds: 200,
  };
}

describe('resolveCategorySource', () => {
  it('resolves a single category unchanged', async () => {
    catalogMocks.getCategoryCatalog.mockResolvedValue([track('a'), track('b')]);

    const source = resolveCategorySource('year-2020');

    expect(source.sourceId).toBe('year-2020');
    expect(source.label).toBe('Top Hits 2020');
    expect(await source.loadCatalog()).toHaveLength(2);
  });

  it('merges and dedupes catalogs when categories are combined, with an order-independent id', async () => {
    catalogMocks.getCategoryCatalog.mockImplementation(async (id: string) =>
      id === 'year-2020'
        ? [track('shared'), track('only-2020')]
        : [track('shared'), track('only-2021')],
    );

    const a = resolveCategorySource('year-2020+year-2021');
    const b = resolveCategorySource('year-2021+year-2020');

    expect(a.sourceId).toBe(b.sourceId);
    expect(a.label).toBe('Top Hits 2020 + Top Hits 2021');

    const pool = await a.loadCatalog();
    expect(pool.map((t) => t.deezerTrackId).sort()).toEqual(['only-2020', 'only-2021', 'shared']);
  });

  it('rejects an unknown category', () => {
    expect(() => resolveCategorySource('not-a-real-category')).toThrow('Unknown category');
  });

  it('rejects combining a soundtrack collection with a song category', () => {
    expect(() => resolveCategorySource(`year-2020+${soundtrackId}`)).toThrow(
      'Soundtrack categories cannot be combined',
    );
  });

  it('rejects combining more than five categories', () => {
    const tooMany = [
      'year-2020',
      'year-2021',
      'year-2022',
      'year-2023',
      'year-2024',
      'year-2025',
    ].join('+');
    expect(() => resolveCategorySource(tooMany)).toThrow('Combine at most 5 categories');
  });
});
