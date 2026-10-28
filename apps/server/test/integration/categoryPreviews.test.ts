import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getCategoryCatalog } from '../../src/services/categoryCatalogService';
import { getFreshPreviewUrl } from '../../src/services/deezerService';

/**
 * Deezer answered from memory. Playlists carry previews for every track, as the real API does, and
 * every call is counted by kind so the test can see which path a lookup took.
 */
const calls = { playlist: 0, track: 0 };
function stubDeezer() {
  calls.playlist = 0;
  calls.track = 0;
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input));
    const list = url.pathname.match(/^\/playlist\/(\d+)\/tracks$/);
    if (list) {
      calls.playlist++;
      const data = Array.from({ length: 30 }, (_, i) => {
        const id = Number(`${list[1]!.slice(-4)}${String(i).padStart(2, '0')}`);
        return {
          id,
          title: `Song ${id}`,
          duration: 30,
          preview: `https://cdnt-preview.dzcdn.net/${id}.mp3`,
          artist: { name: `Artist ${id}` },
        };
      });
      return new Response(JSON.stringify({ data }));
    }
    if (/^\/track\/\d+$/.test(url.pathname)) calls.track++;
    return new Response(JSON.stringify({ error: { message: 'not stubbed' } }));
  });
}

beforeEach(stubDeezer);
afterEach(() => vi.unstubAllGlobals());

describe('category previews', () => {
  it('a stored pool fetches its playlists once, and its songs need no lookup each', async () => {
    // The first load builds and stores the pool. The second is served from the database, whose
    // preview URLs have expired, so it fetches the playlists to warm the cache; the third does not.
    const pool = await getCategoryCatalog('decade-90s');
    const built = calls.playlist;
    await getCategoryCatalog('decade-90s');
    const warmed = calls.playlist;
    expect(warmed).toBeGreaterThan(built);
    await getCategoryCatalog('decade-90s');
    expect(calls.playlist).toBe(warmed);

    for (const t of pool.slice(0, 20))
      expect(await getFreshPreviewUrl(t.deezerTrackId)).not.toBeNull();
    expect(calls.track).toBe(0);
  });
});
