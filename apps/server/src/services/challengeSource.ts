/**
 * What a ten-round challenge is built from.
 *
 * Artist Mode and Category Mode play identically — same rounds, same snippet schedule, same
 * sessions and leaderboards — and differ only in where the candidate tracks come from and what
 * the run is labelled. Describing that difference as data lets both modes share one copy of the
 * challenge machinery instead of maintaining two that drift apart.
 *
 * `sourceId` is the challenge's identity in the database. Artist runs store a numeric Deezer
 * artist id, category runs a slug like "year-2024", so the two can never collide even though
 * they share a column — but nothing should ever infer the kind by inspecting the string.
 * `sourceType` is the only thing that decides that.
 */
import { getArtistById, type ArtistTrack } from './deezerService';
import { getArtistCatalog } from './artistCatalogService';
import { getCategoryCatalog } from './categoryCatalogService';
import { findCategory, isSoundtrackCategory, type Category } from './categories';

/**
 * Merges catalogs into one pool, deduped by Deezer track id, in a stable order.
 *
 * Each track is tagged with the category it came from (`categoryId`) so that multiple-choice
 * decoys can later be kept within one category rather than the whole merge — otherwise mixing,
 * say, an English chart with Bollywood would let a player spot the answer by "which option
 * looks like a different language" instead of actually knowing the song.
 */
async function mergeCatalogs(categoryIds: string[]): Promise<ArtistTrack[]> {
  const pools = await Promise.all(
    categoryIds.map(async (id) => ({ id, tracks: await getCategoryCatalog(id) })),
  );
  const seen = new Set<string>();
  const merged: ArtistTrack[] = [];
  for (const pool of pools) {
    for (const track of pool.tracks) {
      if (!seen.has(track.deezerTrackId)) {
        seen.add(track.deezerTrackId);
        merged.push({ ...track, categoryId: pool.id });
      }
    }
  }
  return merged;
}

export type ChallengeSourceType = 'artist' | 'category' | 'era' | 'daily';

export interface ChallengeSource {
  sourceType: ChallengeSourceType;
  /** Deezer artist id (as a string) or category slug. Stored in `artist_challenges`. */
  sourceId: string;
  /** Shown as the challenge's name — the artist's name, or the category label. */
  label: string;
  /** Artwork for the round screen; categories have none. */
  pictureUrl: string | null;
  /**
   * Part of a challenge's identity for artists, where it changes which tracks are eligible.
   * Always false for categories: every track there is by a different artist, so filtering on
   * "feat." would only throw away legitimate songs.
   */
  includeFeatures: boolean;
  /**
   * True for Guess the Movie sources, where a track's `title` is the *film* and its `artist`
   * holds the song. Options must hide `artist` for these, or a player who recognises the track
   * by ear reads the answer off the option list instead of naming the film.
   */
  answerIsTitle: boolean;
  /** The full playable pool the ten rounds are drawn from, and that decoys/search read. */
  loadCatalog: () => Promise<ArtistTrack[]>;
}

export async function resolveArtistSource(
  artistId: number,
  includeFeatures: boolean,
): Promise<ChallengeSource> {
  const catalogPromise = getArtistCatalog(artistId, includeFeatures);
  const artist = await getArtistById(artistId);
  if (!artist) throw new Error('Artist not found');

  return {
    sourceType: 'artist',
    sourceId: String(artistId),
    label: artist.name,
    pictureUrl: artist.pictureUrl,
    includeFeatures,
    answerIsTitle: false,
    loadCatalog: () => catalogPromise,
  };
}

/** Categories can be combined into one run, joined by this separator in the URL/DB id. Never
 *  appears inside a category slug itself (slugs are `[a-z0-9-]+`), so splitting is unambiguous. */
export const CATEGORY_ID_SEPARATOR = '+';
const MAX_COMBINED_CATEGORIES = 5;

export function resolveCategorySource(categoryId: string): ChallengeSource {
  const ids = [...new Set(categoryId.split(CATEGORY_ID_SEPARATOR))].sort();
  if (ids.length > MAX_COMBINED_CATEGORIES) {
    throw new Error(`Combine at most ${MAX_COMBINED_CATEGORIES} categories`);
  }
  const categories: Category[] = ids.map((id) => {
    const category = findCategory(id);
    if (!category) throw new Error('Unknown category');
    return category;
  });
  // A movie collection's answer is the film, not a song, so its options render differently.
  // Merging one into a song pool would ask half the rounds in a format the UI never shows.
  if (categories.length > 1 && categories.some(isSoundtrackCategory)) {
    throw new Error('Soundtrack categories cannot be combined with others');
  }

  if (categories.length === 1) {
    const category = categories[0]!;
    return {
      sourceType: 'category',
      sourceId: category.id,
      label: category.label,
      pictureUrl: null,
      includeFeatures: false,
      answerIsTitle: isSoundtrackCategory(category),
      loadCatalog: () => getCategoryCatalog(category.id),
    };
  }

  return {
    sourceType: 'category',
    sourceId: ids.join(CATEGORY_ID_SEPARATOR),
    label: categories.map((c) => c.label).join(' + '),
    pictureUrl: null,
    includeFeatures: false,
    answerIsTitle: false,
    loadCatalog: () => mergeCatalogs(ids),
  };
}

const DAILY_POOL_CATEGORIES = [
  'now-worldwide',
  'year-2025',
  'year-2023',
  'year-2020',
  'year-2015',
  'year-2010',
  'year-2005',
  'year-2000',
];

export function resolveDailySource(_dateStr: string): ChallengeSource {
  return {
    sourceType: 'daily',
    sourceId: 'daily',
    label: 'Daily Challenge',
    pictureUrl: null,
    includeFeatures: false,
    answerIsTitle: false,
    loadCatalog: () => mergeCatalogs(DAILY_POOL_CATEGORIES.filter((id) => findCategory(id))),
  };
}
