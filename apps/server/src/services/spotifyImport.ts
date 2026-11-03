/**
 * Brings a Spotify playlist into the playlist builder.
 *
 * Chorusify plays Deezer previews, so a Spotify playlist is only a list of names: each one is looked
 * up on Deezer and the best match with a preview is kept. Names come from Spotify's public embed
 * page, which needs no key.
 *
 * shortcut: the embed page is not an API. It lists about the first 100 tracks and its markup can
 * change without notice; if it breaks this says so and the host adds songs by search. Upgrade to the
 * Web API with client credentials if imports matter enough to hold a Spotify key.
 */
import { foldForSearch } from '../utils/songAliases';
import { TtlCache } from '../utils/ttlCache';
import { searchSongs, type SongSearchHit as SongHit } from './deezerService';

export class SpotifyImportError extends Error {}

interface SpotifyTrack {
  title: string;
  artist: string;
}

/** A playlist or album link, or a spotify: URI. Only the id is kept, so no other URL is fetched. */
export function parseSpotifyUrl(input: string): { kind: 'playlist' | 'album'; id: string } | null {
  const match =
    /(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?|spotify:)(playlist|album)[/:]([A-Za-z0-9]{22})/.exec(
      input.trim(),
    );
  return match ? { kind: match[1] as 'playlist' | 'album', id: match[2]! } : null;
}

/** Lower case, accents gone, and the "(feat. X)" or "- Remastered 2011" tails dropped. */
function comparable(text: string): string {
  return foldForSearch(text.replace(/\s[-–]\s.*$|\s*[([].*?[)\]]/g, ''));
}

/** The hit that is this song: same title, an artist in common, and audio to play. */
export function pickMatch(track: SpotifyTrack, hits: SongHit[]): SongHit | null {
  const title = comparable(track.title);
  const artists = track.artist
    .split(',')
    .map((a) => comparable(a))
    .filter(Boolean);
  const playable = hits.filter((h) => h.previewUrl);
  const sameTitle = playable.filter((h) => comparable(h.title) === title);
  return (
    sameTitle.find((h) => artists.some((a) => comparable(h.artist).includes(a))) ??
    // Deezer and Spotify credit features differently, so an exact title alone is the fallback.
    sameTitle[0] ??
    null
  );
}

async function readTrackList(
  kind: string,
  id: string,
): Promise<{ name: string; tracks: SpotifyTrack[] }> {
  const res = await fetch(`https://open.spotify.com/embed/${kind}/${id}`, {
    headers: { 'User-Agent': 'Mozilla/5.0 (compatible; Chorusify playlist import)' },
    signal: AbortSignal.timeout(10_000),
  }).catch(() => null);
  if (!res?.ok) throw new SpotifyImportError('Spotify did not return that playlist. Is it public?');
  const html = await res.text();
  const data = /<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/.exec(
    html,
  );
  let entity:
    | { name?: string; title?: string; trackList?: { title?: string; subtitle?: string }[] }
    | undefined;
  try {
    entity = data ? JSON.parse(data[1]!)?.props?.pageProps?.state?.data?.entity : undefined;
  } catch {
    entity = undefined;
  }
  if (!entity?.trackList) {
    throw new SpotifyImportError(
      'Could not read that playlist from Spotify. Add the songs by search.',
    );
  }
  return {
    name: entity.name ?? entity.title ?? 'Spotify playlist',
    tracks: entity.trackList.flatMap((t) =>
      t.title ? [{ title: t.title, artist: (t.subtitle ?? '').replace(/ /g, ' ') }] : [],
    ),
  };
}

const imports = new TtlCache<{ name: string; matched: SongHit[]; missing: SpotifyTrack[] }>(200);

export async function importSpotifyPlaylist(url: string, limit: number) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new SpotifyImportError('That is not a Spotify playlist or album link.');
  const key = `${parsed.kind}:${parsed.id}`;
  const cached = imports.get(key);
  if (cached) return cached;

  const { name, tracks } = await readTrackList(parsed.kind, parsed.id);
  const matched: SongHit[] = [];
  const missing: SpotifyTrack[] = [];
  const seen = new Set<string>();
  // A few at a time: every lookup goes through the shared Deezer budget anyway.
  const list = tracks.slice(0, limit);
  for (let i = 0; i < list.length; i += 5) {
    const batch = list.slice(i, i + 5);
    const found = await Promise.all(
      batch.map((t) =>
        searchSongs(`${comparable(t.title)} ${t.artist.split(',')[0] ?? ''}`).then((hits) =>
          pickMatch(t, hits),
        ),
      ),
    );
    found.forEach((hit, j) => {
      if (hit && !seen.has(hit.deezerTrackId)) {
        seen.add(hit.deezerTrackId);
        matched.push(hit);
      } else if (!hit) missing.push(batch[j]!);
    });
  }
  const result = { name, matched, missing };
  imports.set(key, result, 10 * 60 * 1000);
  return result;
}
