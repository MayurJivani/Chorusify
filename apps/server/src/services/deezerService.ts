/**
 * Deezer's preview URLs are HMAC-signed with a short expiry (observed ~15 minutes from
 * issuance), so the `preview_url` stored on a `songs` row at curation time cannot be reused
 * for playback later — it must be re-fetched close to the moment a player actually needs it.
 * This wraps that live lookup with a short in-memory cache (comfortably under the token's
 * real TTL) so concurrent players loading the same daily puzzle don't each trigger their own
 * call to Deezer's public API.
 */
import {
  isUnwantedVersion,
  mentionsFeature,
  normalizeTitle,
  stripAnyTrailingQualifier,
  stripVersionSuffix,
} from '../utils/trackFilters';
import { logger } from '../logger';
import { TtlCache } from '../utils/ttlCache';
import { count, registerMetricSources } from './metrics';

interface FreshPreview {
  previewUrl: string;
  durationSeconds: number;
  artist?: string;
}

/**
 * Deezer allows roughly 50 requests per 5 seconds per IP. Over that it does *not* fail the
 * HTTP request — it returns 200 with `{"error":{"message":"Quota limit exceeded"}}`, which
 * reads exactly like "this track has no preview" unless you look for it.
 *
 * That distinction matters because the two kinds of call compete: crawling one artist's
 * discography costs a request per album (over a hundred for a large artist) and would burn the
 * whole quota, so the preview lookup a player is actually waiting on came back "unavailable"
 * and their challenge 503'd. Routing every outbound call through one window keeps the process
 * under the limit no matter what mix of work is in flight, and quota responses are retried
 * rather than mistaken for missing content.
 */
const DEEZER_WINDOW_MS = 5000;
const QUOTA_RETRIES = 3;

/**
 * Three budgets, because the traffic is three very different things. Interactive lookups (the
 * preview a player is staring at a spinner for) may use the whole window; a host's song search and
 * bulk crawling a discography stop short of it. That reserve is the point: a crawl issues hundreds
 * of requests back to back and would otherwise hold the entire quota for its duration, so the one
 * request that actually blocks a player would queue behind it or come back as a quota error
 * indistinguishable from "no preview exists".
 */
const DEEZER_MAX_PER_WINDOW = 45; // headroom under Deezer's ~50
const DEEZER_BULK_PER_WINDOW = 30; // leaves 15 slots for interactive lookups
const DEEZER_SEARCH_PER_WINDOW = 20; // hosts typing cannot starve a live game of previews
type DeezerPriority = 'interactive' | 'search' | 'bulk';

/** A hung connection must not hold a slot, or a room's start, indefinitely. */
const DEEZER_TIMEOUT_MS = 8000;
const DEEZER_MAX_CONCURRENT = 12;
const NETWORK_RETRIES = 2;
const BREAKER_THRESHOLD = 5;
const BREAKER_OPEN_MS = 30_000;

let windowStartedAt = 0;
let windowCount = 0;
let inFlightCount = 0;
let consecutiveFailures = 0;
let breakerOpenUntil = 0;
const concurrencyQueue: (() => void)[] = [];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
/** Full jitter, so callers that failed together do not retry together. */
const backoff = (attempt: number): number => Math.random() * 500 * 2 ** attempt;

async function acquireDeezerSlot(priority: DeezerPriority): Promise<void> {
  const limit =
    priority === 'bulk'
      ? DEEZER_BULK_PER_WINDOW
      : priority === 'search'
        ? DEEZER_SEARCH_PER_WINDOW
        : DEEZER_MAX_PER_WINDOW;
  for (;;) {
    const now = Date.now();
    if (now - windowStartedAt >= DEEZER_WINDOW_MS) {
      windowStartedAt = now;
      windowCount = 0;
    }
    if (windowCount < limit) {
      windowCount += 1;
      return;
    }
    await sleep(DEEZER_WINDOW_MS - (now - windowStartedAt));
  }
}

async function withConcurrencyLimit<T>(work: () => Promise<T>): Promise<T> {
  if (inFlightCount >= DEEZER_MAX_CONCURRENT) {
    await new Promise<void>((resolve) => concurrencyQueue.push(resolve));
  } else {
    inFlightCount += 1;
  }
  try {
    return await work();
  } finally {
    // The slot passes straight to the next waiter, so the count stays right.
    const next = concurrencyQueue.shift();
    if (next) next();
    else inFlightCount -= 1;
  }
}

function recordFailure(): void {
  count('deezerErrors');
  consecutiveFailures += 1;
  if (consecutiveFailures >= BREAKER_THRESHOLD && Date.now() >= breakerOpenUntil) {
    breakerOpenUntil = Date.now() + BREAKER_OPEN_MS;
    count('deezerBreakerOpens');
    logger.error('Deezer is failing: pausing calls for 30s and serving what is cached');
  }
}

function isQuotaError(body: unknown): boolean {
  if (typeof body !== 'object' || body === null) return false;
  const error = (body as { error?: unknown }).error;
  if (typeof error !== 'object' || error === null) return false;
  const message = (error as { message?: unknown }).message;
  return typeof message === 'string' && /quota/i.test(message);
}

/** Identical GETs running right now, so any number of callers cost one request. */
const pendingGets = new Map<string, Promise<unknown>>();

/**
 * Every Deezer call in the app goes through here: the budget window, a concurrency cap, a timeout,
 * retries with jitter, a circuit breaker, and sharing of identical in-flight requests. Returns null
 * if the request failed outright, which callers already treat as "nothing available", so an outage
 * degrades to cached data rather than an exception on the game loop.
 */
export function deezerFetchJson<T>(url: string, priority: DeezerPriority | boolean = 'interactive'): Promise<T | null> {
  const pending = pendingGets.get(url);
  if (pending) {
    count('deezerCoalesced');
    return pending as Promise<T | null>;
  }
  const level: DeezerPriority =
    priority === true ? 'bulk' : priority === false ? 'interactive' : priority;
  const request = withConcurrencyLimit(() => attemptDeezerFetch<T>(url, level)).finally(() =>
    pendingGets.delete(url),
  );
  pendingGets.set(url, request);
  return request;
}

async function attemptDeezerFetch<T>(url: string, priority: DeezerPriority): Promise<T | null> {
  let networkFailures = 0;
  for (let attempt = 0; attempt <= QUOTA_RETRIES; attempt += 1) {
    if (Date.now() < breakerOpenUntil) return null;
    await acquireDeezerSlot(priority);

    let res: Response;
    try {
      count('deezerRequests');
      res = await fetch(url, {
        headers: { Referer: 'https://chorusify.com/' },
        signal: AbortSignal.timeout(DEEZER_TIMEOUT_MS),
      });
    } catch (err) {
      recordFailure();
      if (networkFailures++ >= NETWORK_RETRIES) {
        logger.warn({ err, url }, 'Deezer request failed');
        return null;
      }
      await sleep(backoff(networkFailures));
      continue;
    }
    if (res.status >= 500) {
      recordFailure();
      if (networkFailures++ >= NETWORK_RETRIES) return null;
      await sleep(backoff(networkFailures));
      continue;
    }
    if (!res.ok) return null;

    let body: T;
    try {
      body = (await res.json()) as T;
    } catch {
      recordFailure();
      return null;
    }
    consecutiveFailures = 0;
    if (!isQuotaError(body)) return body;

    count('deezerErrors');
    if (attempt < QUOTA_RETRIES) {
      logger.warn({ url, attempt }, 'Deezer quota exceeded; backing off');
      await sleep(DEEZER_WINDOW_MS);
    }
  }

  logger.warn({ url }, 'Deezer quota still exceeded after retries');
  return null;
}

/** Test helper: resets the budget and breaker so suites don't inherit each other's state. */
export function __resetDeezerRateLimit(): void {
  windowStartedAt = 0;
  windowCount = 0;
  consecutiveFailures = 0;
  breakerOpenUntil = 0;
  pendingGets.clear();
}

const CACHE_TTL_MS = 10 * 60 * 1000;
/** Tracks seen so far; well above any category plus every running playlist. */
const PREVIEW_CACHE_MAX = 20_000;
const cache = new TtlCache<FreshPreview>(PREVIEW_CACHE_MAX);
/** "No preview" is remembered briefly, so a dead track is not looked up by every room. */
const NEGATIVE_TTL_MS = 60 * 1000;
const noPreview = new TtlCache<true>(PREVIEW_CACHE_MAX);
/**
 * Stale previews are only served while Deezer is unreachable, and only while the signature could
 * still be valid. Observed lifetime is about fifteen minutes, so past this they are never reused.
 */
const STALE_LIMIT_MS = 14 * 60 * 1000;

interface DeezerTrackResponse {
  preview?: string;
  duration?: number;
  artist?: { name: string };
  contributors?: { name: string }[];
  error?: unknown;
}

function buildArtistString(body: DeezerTrackResponse): string | undefined {
  if (body.contributors && body.contributors.length > 0) {
    return body.contributors.map((c) => c.name).join(', ');
  }
  return body.artist?.name;
}

export async function getFreshPreviewUrl(deezerTrackId: string): Promise<FreshPreview | null> {
  const cached = cache.get(deezerTrackId);
  if (cached) return cached;
  if (noPreview.has(deezerTrackId)) return null;

  const body = await deezerFetchJson<DeezerTrackResponse>(
    `https://api.deezer.com/track/${encodeURIComponent(deezerTrackId)}`,
  );
  if (!body) {
    // Deezer unreachable: a url signed recently enough may still play, and a round is better
    // with it than without. Never reused past the signature's life, unlike the cached copy.
    return cache.peek(deezerTrackId, STALE_LIMIT_MS) ?? null;
  }
  if (!body.preview || body.error) {
    noPreview.set(deezerTrackId, true, NEGATIVE_TTL_MS);
    return null;
  }

  const value: FreshPreview = {
    previewUrl: body.preview,
    durationSeconds: body.duration ?? 0,
    artist: buildArtistString(body),
  };
  cache.set(deezerTrackId, value, CACHE_TTL_MS);
  return value;
}

/** Pre-seeds the preview cache from bulk track data that already includes preview URLs.
 *  Avoids a per-track /track/{id} call when the data was just fetched. */
function seedPreviewCache(tracks: DeezerAlbumTrack[]): void {
  for (const t of tracks) {
    if (!t.preview) continue;
    const trackId = String(t.id);
    if (cache.has(trackId)) continue;
    const artist =
      t.contributors && t.contributors.length > 0
        ? t.contributors.map((c) => c.name).join(', ')
        : t.artist?.name;
    cache.set(
      trackId,
      { previewUrl: t.preview, durationSeconds: t.duration, artist },
      CACHE_TTL_MS,
    );
  }
}

/** Pre-seeds preview cache from playlist tracks (which already carry preview URLs). */
export function seedPreviewCacheFromPlaylist(
  tracks: { deezerTrackId: string; previewUrl: string; durationSeconds: number; artist: string }[],
): void {
  for (const t of tracks) {
    if (cache.has(t.deezerTrackId)) continue;
    cache.set(
      t.deezerTrackId,
      {
        previewUrl: t.previewUrl,
        durationSeconds: t.durationSeconds,
        artist: t.artist,
      },
      CACHE_TTL_MS,
    );
  }
}

export function clearPreviewCache(): void {
  cache.clear();
  noPreview.clear();
}

// --- Song search (event playlists) -------------------------------------------------------

export interface SongSearchHit {
  deezerTrackId: string;
  title: string;
  artist: string;
  album: string | null;
  albumArtUrl: string | null;
  durationSeconds: number;
  previewUrl: string | null;
}

interface DeezerSearchTrack {
  id?: number;
  title?: string;
  duration?: number;
  preview?: string;
  artist?: { name?: string };
  album?: { title?: string; cover_medium?: string };
}

export const SONG_SEARCH_LIMIT = 25;
const SEARCH_TTL_MS = 30 * 60 * 1000;
const EMPTY_SEARCH_TTL_MS = 60 * 1000;
const searchCache = new TtlCache<SongSearchHit[]>(2000);

/**
 * Searches Deezer's catalogue. Results are shared across hosts, an identical search already
 * running is joined rather than repeated, and when Deezer is down the last answer for that search
 * is served even if it has aged out.
 */
export async function searchSongs(
  query: string,
  field: 'any' | 'artist' | 'album' = 'any',
): Promise<SongSearchHit[]> {
  const normalized = query.trim().toLowerCase().replace(/\s+/g, ' ');
  const key = `${field}:${normalized}`;
  const cached = searchCache.get(key);
  if (cached) {
    count('searchCacheHits');
    return cached;
  }
  count('searchCacheMisses');

  const escaped = normalized.replace(/"/g, ' ');
  const q = field === 'any' ? escaped : `${field}:"${escaped}"`;
  const body = await deezerFetchJson<{ data?: DeezerSearchTrack[] }>(
    `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=${SONG_SEARCH_LIMIT}`,
    'search',
  );
  if (!body) return searchCache.peek(key) ?? [];

  const hits: SongSearchHit[] = (body.data ?? []).flatMap((t) =>
    t.id && t.title
      ? [
          {
            deezerTrackId: String(t.id),
            title: t.title,
            artist: t.artist?.name ?? 'Unknown',
            album: t.album?.title ?? null,
            albumArtUrl: t.album?.cover_medium ?? null,
            durationSeconds: t.duration ?? 0,
            previewUrl: t.preview || null,
          },
        ]
      : [],
  );
  searchCache.set(key, hits, hits.length ? SEARCH_TTL_MS : EMPTY_SEARCH_TTL_MS);
  seedPreviewCacheFromPlaylist(
    hits.flatMap((h) =>
      h.previewUrl
        ? [
            {
              deezerTrackId: h.deezerTrackId,
              previewUrl: h.previewUrl,
              durationSeconds: h.durationSeconds,
              artist: h.artist,
            },
          ]
        : [],
    ),
  );
  return hits;
}

registerMetricSources({
  deezer: () => ({
    breakerOpen: Date.now() < breakerOpenUntil,
    previewCache: { size: cache.size, hits: cache.hits, misses: cache.misses },
    searchCache: { size: searchCache.size, hits: searchCache.hits, misses: searchCache.misses },
  }),
});

// --- Artist lookups (Artist Mode) -------------------------------------------------------

const ARTIST_CACHE_TTL_MS = 60 * 60 * 1000;

export interface ArtistSearchResult {
  id: number;
  name: string;
  pictureUrl: string | null;
}

interface DeezerArtistResponse {
  id?: number;
  name?: string;
  picture_medium?: string;
  nb_fan?: number;
  error?: unknown;
}

interface DeezerArtistSearchResponse {
  data: DeezerArtistResponse[];
}

export async function searchArtists(query: string): Promise<ArtistSearchResult[]> {
  const body = await deezerFetchJson<DeezerArtistSearchResponse>(
    `https://api.deezer.com/search/artist?q=${encodeURIComponent(query)}&limit=5`,
  );
  if (!body) return [];

  return (body.data ?? [])
    .filter(
      (a): a is Required<Pick<DeezerArtistResponse, 'id' | 'name'>> & DeezerArtistResponse =>
        typeof a.id === 'number' && typeof a.name === 'string',
    )
    .sort((a, b) => (b.nb_fan ?? 0) - (a.nb_fan ?? 0))
    .slice(0, 5)
    .map((a) => ({ id: a.id, name: a.name, pictureUrl: a.picture_medium ?? null }));
}

const artistCache = new TtlCache<{ id: number; name: string; pictureUrl: string | null } | null>(
  5000,
);

export async function getArtistById(
  artistId: number,
): Promise<{ id: number; name: string; pictureUrl: string | null } | null> {
  const cached = artistCache.get(String(artistId));
  if (cached !== undefined) return cached;

  const body = await deezerFetchJson<DeezerArtistResponse>(
    `https://api.deezer.com/artist/${artistId}`,
  );

  const value: { id: number; name: string; pictureUrl: string | null } | null =
    body?.id && body.name && !body.error
      ? { id: body.id, name: body.name, pictureUrl: body.picture_medium ?? null }
      : null;

  artistCache.set(String(artistId), value, ARTIST_CACHE_TTL_MS);
  return value;
}

export interface ArtistTrack {
  deezerTrackId: string;
  title: string;
  artist: string;
  albumArtUrl: string | null;
  durationSeconds: number;
  /** Only set for Era mode, where it is the answer. Deezer's track listings don't carry a
   *  release date, so this is inferred from which "Top Hits <year>" list a track came from. */
  releaseYear?: number;
  /** Only set when the pool is a merge of several categories (see mergeCatalogs in
   *  challengeSource.ts) - which original category this track came from, so multiple-choice
   *  decoys can be kept from the same category as the answer rather than the whole merge. */
  categoryId?: string;
}

interface DeezerAlbum {
  id: number;
  title: string;
  nb_tracks: number;
  cover_medium?: string;
  record_type?: string;
}

interface DeezerAlbumListResponse {
  data: DeezerAlbum[];
  next?: string;
}

interface DeezerAlbumTrack {
  id: number;
  title: string;
  duration: number;
  preview?: string;
  artist?: { name: string };
  contributors?: { name: string }[];
  album?: { cover_medium?: string };
}

interface DeezerAlbumTrackResponse {
  data: DeezerAlbumTrack[];
  next?: string;
}

async function fetchAllAlbums(artistId: number): Promise<DeezerAlbum[]> {
  const albums: DeezerAlbum[] = [];
  let url: string | null = `https://api.deezer.com/artist/${artistId}/albums?limit=100`;

  while (url) {
    // Annotated because `url` is reassigned from `body.next`, which otherwise makes the
    // inference circular.
    const body: DeezerAlbumListResponse | null = await deezerFetchJson(url, true);
    if (!body) break;
    albums.push(...(body.data ?? []));
    url = body.next ?? null;
  }

  return albums;
}

async function fetchAlbumTracks(albumId: number): Promise<DeezerAlbumTrack[]> {
  const tracks: DeezerAlbumTrack[] = [];
  let url: string | null = `https://api.deezer.com/album/${albumId}/tracks?limit=100`;

  while (url) {
    const body: DeezerAlbumTrackResponse | null = await deezerFetchJson(url, true);
    if (!body) break;
    tracks.push(...(body.data ?? []));
    url = body.next ?? null;
  }

  return tracks;
}

/**
 * An artist's top tracks straight from Deezer, bypassing albums entirely.
 *
 * Used as a fallback, because `/artist/{id}/albums` is empty for anyone who doesn't release
 * under their own name — composers and producers above all. Pritam has ~95 playable top tracks
 * and *zero* albums, since his work sits on film soundtracks and singers' releases, so the
 * album crawl produced nothing and Artist Mode refused to build a challenge for him.
 */
async function fetchArtistTopChart(artistId: number): Promise<DeezerAlbumTrack[]> {
  const tracks: DeezerAlbumTrack[] = [];
  let url: string | null = `https://api.deezer.com/artist/${artistId}/top?limit=100`;

  while (url) {
    const body: DeezerAlbumTrackResponse | null = await deezerFetchJson(url, true);
    if (!body) break;
    tracks.push(...(body.data ?? []));
    url = body.next ?? null;
  }

  return tracks;
}

// Each entry can hold a whole discography, so this bound is what keeps memory flat.
const topTracksCache = new TtlCache<ArtistTrack[]>(200);

/**
 * Discography fetches that are currently running, keyed the same way as the cache.
 *
 * Building the pool for a popular artist costs one request per album (~126 for Taylor Swift)
 * and takes several seconds, during which the cache is still empty. Without this, every
 * player who opens the same artist in that window starts their own full crawl — N times the
 * latency for them and N times the load on Deezer, right when it is already slowest. Sharing
 * the in-flight promise means the second and later callers wait on the first one's result.
 */
const topTracksInFlight = new Map<string, Promise<ArtistTrack[]>>();

/**
 * Fetches an artist's full discography (all albums → all tracks), filtering out
 * karaoke/tribute/acoustic/live/remix/etc. versions and deduplicating by base title so
 * alternate versions (e.g. "Eyes Closed (2x Speed)", "Pillowtalk (Living Room Session)")
 * never replace the main recording. `includeFeatures` controls whether tracks whose title
 * credits another artist as a feature are kept.
 *
 * Results are cached for one hour. For popular artists with many albums this may take a
 * moment on the first call, but subsequent loads within the hour reuse the cached pool.
 */
export async function getArtistTopTracks(
  artistId: number,
  includeFeatures = false,
): Promise<ArtistTrack[]> {
  const cacheKey = `${artistId}:${includeFeatures}`;
  const cached = topTracksCache.get(cacheKey);
  if (cached) return cached;

  const inFlight = topTracksInFlight.get(cacheKey);
  if (inFlight) {
    return inFlight;
  }

  const pending = fetchArtistTopTracks(artistId, includeFeatures)
    .then((tracks) => {
      topTracksCache.set(cacheKey, tracks, ARTIST_CACHE_TTL_MS);
      return tracks;
    })
    // Always release the slot, success or failure, so one failed crawl can't wedge the artist
    // into permanently returning a rejected promise.
    .finally(() => topTracksInFlight.delete(cacheKey));

  topTracksInFlight.set(cacheKey, pending);
  return pending;
}

/** A challenge needs ten tracks; below this the album crawl is treated as having failed and
 *  the top-tracks fallback kicks in. Kept local to avoid importing from the challenge service,
 *  which already imports this module. */
const MIN_CATALOG_TRACKS = 10;

/**
 * Turns raw Deezer tracks into the playable catalog: drops unplayable and alternate-version
 * entries, applies the feature filter, and collapses duplicates onto one entry per song.
 *
 * Extracted so the album crawl and the top-tracks fallback go through exactly the same rules —
 * a fallback that filtered differently would quietly produce a different kind of catalog.
 */
function buildCatalog(
  rawTracks: (DeezerAlbumTrack & { albumId?: number })[],
  includeFeatures: boolean,
  albumCovers: Map<number, string | null>,
): ArtistTrack[] {
  const eligible = rawTracks.filter(
    (t) =>
      t.preview && !isUnwantedVersion(t.title) && (includeFeatures || !mentionsFeature(t.title)),
  );

  // Titles this artist releases with no trailing qualifier at all. Anything that reduces to one
  // of these once its qualifier is removed is an alternate cut of that song, whatever the
  // qualifier happens to be called — which is how ZAYN's "EYES CLOSED (BARE)" and
  // "EYES CLOSED (UNVEILED)" collapse onto "EYES CLOSED" without either word being known to
  // the filter. Keyword matching alone left all three in the pool as separate "songs".
  const plainTitles = new Set(
    eligible
      .filter((t) => stripAnyTrailingQualifier(t.title) === t.title.trim())
      .map((t) => normalizeTitle(t.title)),
  );

  const bestByBase = new Map<string, ArtistTrack>();

  for (const t of eligible) {
    const artist =
      t.contributors && t.contributors.length > 0
        ? t.contributors.map((c) => c.name).join(', ')
        : (t.artist?.name ?? 'Unknown');
    const candidate: ArtistTrack = {
      deezerTrackId: String(t.id),
      title: t.title,
      artist,
      albumArtUrl:
        t.album?.cover_medium ?? (t.albumId != null ? (albumCovers.get(t.albumId) ?? null) : null),
      durationSeconds: t.duration,
    };

    const strippedBare = normalizeTitle(stripAnyTrailingQualifier(t.title));
    const base = plainTitles.has(strippedBare)
      ? strippedBare
      : normalizeTitle(stripVersionSuffix(t.title));

    const existing = bestByBase.get(base);
    if (!existing || isPlainerTitle(base, existing.title, candidate.title)) {
      bestByBase.set(base, candidate);
    }
  }

  // Sort by track id before returning. Callers feed this list straight into `seededShuffle` to
  // pick "these 10 tracks for this artist on this date", which is only reproducible if the
  // input order is too — and map insertion order follows whichever worker finished first.
  return [...bestByBase.values()].sort((a, b) => a.deezerTrackId.localeCompare(b.deezerTrackId));
}

async function crawlAlbumTracks(
  albums: DeezerAlbum[],
): Promise<(DeezerAlbumTrack & { albumId: number })[]> {
  const CONCURRENCY = 8;
  const allRawTracks: (DeezerAlbumTrack & { albumId: number })[] = [];
  let nextAlbumIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const album = albums[nextAlbumIndex];
      nextAlbumIndex += 1;
      if (!album) return;
      try {
        const tracks = await fetchAlbumTracks(album.id);
        for (const t of tracks) allRawTracks.push({ ...t, albumId: album.id });
      } catch (err) {
        logger.warn({ err, albumId: album.id }, 'Album track fetch failed; skipping album');
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, albums.length) }, () => worker()));
  return allRawTracks;
}

/** Full album crawl, used either as the slow path or for background enrichment. */
export async function fetchFullDiscography(
  artistId: number,
  includeFeatures: boolean,
): Promise<ArtistTrack[]> {
  const albums = await fetchAllAlbums(artistId);
  logger.info(`Found ${albums.length} albums for artist ${artistId}`);

  const albumCovers = new Map<number, string | null>();
  for (const a of albums) albumCovers.set(a.id, a.cover_medium ?? null);

  const allRawTracks = await crawlAlbumTracks(albums);
  seedPreviewCache(allRawTracks);
  let tracks = buildCatalog(allRawTracks, includeFeatures, albumCovers);

  if (tracks.length < MIN_CATALOG_TRACKS) {
    logger.info(
      { artistId, fromAlbums: tracks.length },
      'Album crawl came up short; merging top tracks',
    );
    const topChart = await fetchArtistTopChart(artistId);
    tracks = buildCatalog([...allRawTracks, ...topChart], includeFeatures, albumCovers);
  }

  logger.info(
    `Discography for artist ${artistId}: ${allRawTracks.length} raw → ${tracks.length} after filtering`,
  );
  return tracks;
}

async function fetchArtistTopTracks(
  artistId: number,
  includeFeatures: boolean,
): Promise<ArtistTrack[]> {
  logger.info(`Fetching catalog for artist ${artistId}...`);

  const topChart = await fetchArtistTopChart(artistId);
  seedPreviewCache(topChart);
  const topTracks = buildCatalog(topChart, includeFeatures, new Map());

  if (topTracks.length >= MIN_CATALOG_TRACKS) {
    logger.info({ artistId, topTracks: topTracks.length }, 'Top tracks sufficient; returning fast');
    return topTracks;
  }

  logger.info(
    { artistId, topTracks: topTracks.length },
    'Top tracks insufficient; falling back to full album crawl',
  );
  return fetchFullDiscography(artistId, includeFeatures);
}

export function clearArtistCaches(): void {
  topTracksInFlight.clear();
  artistCache.clear();
  topTracksCache.clear();
  searchCache.clear();
}

/** Whether `candidateTitle` is a better representative for `base` than `existingTitle` —
 *  the plain (base-matching) title wins; otherwise the shorter, less-qualified title. */
function isPlainerTitle(base: string, existingTitle: string, candidateTitle: string): boolean {
  const existingNorm = normalizeTitle(existingTitle);
  const candidateNorm = normalizeTitle(candidateTitle);
  const existingIsPlain = existingNorm === base;
  const candidateIsPlain = candidateNorm === base;
  if (candidateIsPlain !== existingIsPlain) return candidateIsPlain;
  return candidateNorm.length < existingNorm.length;
}
