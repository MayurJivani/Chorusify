import crypto from 'crypto';
import { eq, and, desc, asc, gt, lt, notExists, or, sql } from 'drizzle-orm';
import { db } from '../db/client';
import {
  artistChallenges,
  artistChallengeTracks,
  artistSessionResults,
  artistRoundGuesses,
} from '../db/schema';
import type { ArtistChallenge, ArtistChallengeTrack, ArtistSessionResult } from '../db/schema';
import { getFreshPreviewUrl, type ArtistTrack } from './deezerService';
import { getArtistCatalog } from './artistCatalogService';
import {
  resolveArtistSource,
  type ChallengeSource,
  type ChallengeSourceType,
} from './challengeSource';
import { seededShuffle } from '../utils/deterministic';
import { normalizeTitle } from '../utils/trackFilters';
import type { Identity } from '../auth/identity';
import { getSettings } from './settingsService';
import { logger } from '../logger';

/**
 * The default run length. The live value is an admin setting, and every challenge records the
 * length it was built with in `artist_challenges.total_rounds` — so this constant is only the
 * fallback for a brand-new challenge, never what decides when an existing run ends.
 */
export const ARTIST_CHALLENGE_SIZE = 10;

export interface ArtistChallengeWithTracks {
  challenge: ArtistChallenge;
  tracks: ArtistChallengeTrack[];
}

export async function loadChallengeTracks(challengeId: number): Promise<ArtistChallengeTrack[]> {
  return db
    .select()
    .from(artistChallengeTracks)
    .where(eq(artistChallengeTracks.challengeId, challengeId))
    .orderBy(asc(artistChallengeTracks.position));
}

async function findChallenge(sourceId: string, challengeDate: string, includeFeatures: boolean) {
  const rows = await db
    .select()
    .from(artistChallenges)
    .where(
      and(
        eq(artistChallenges.deezerArtistId, sourceId),
        eq(artistChallenges.challengeDate, challengeDate),
        eq(artistChallenges.includeFeatures, includeFeatures),
      ),
    )
    .limit(1);
  return rows[0];
}

/**
 * Below this a run is not worth playing at all — one or two songs is a coin toss, not a game.
 * Between here and the configured length the run happens but does not count.
 */
export const MIN_PLAYABLE_ROUNDS = 3;

/** Builds (or returns) the challenge for a source on a given date. */
export async function getOrCreateChallenge(
  source: ChallengeSource,
  challengeDate: string,
): Promise<ArtistChallengeWithTracks> {
  const { sourceId, includeFeatures } = source;
  const existing = await findChallenge(sourceId, challengeDate, includeFeatures);
  if (existing) {
    return { challenge: existing, tracks: await loadChallengeTracks(existing.id) };
  }

  const configuredRounds = (await getSettings()).challengeRounds;

  const pool = await source.loadCatalog();
  if (pool.length < MIN_PLAYABLE_ROUNDS) {
    throw new Error(
      `${source.label} only has ${pool.length} playable ${pool.length === 1 ? 'song' : 'songs'} — not enough for a game`,
    );
  }

  /*
   * A thin catalogue plays short rather than not at all.
   *
   * K/DA and similar have a handful of tracks, and demanding the full length meant they could
   * not be played — the error read like a bug rather than "this artist has six songs". A short
   * run is a perfectly good game; it just is not a comparable score, so it is excluded from
   * ranking instead of being refused.
   */
  const totalRounds = Math.min(configuredRounds, pool.length);
  const ranked = totalRounds >= configuredRounds;

  const chosen = seededShuffle(pool, `${sourceId}:${challengeDate}:${includeFeatures}`).slice(
    0,
    totalRounds,
  );

  let challenge: ArtistChallenge;
  try {
    const insertedRows = await db
      .insert(artistChallenges)
      .values({
        deezerArtistId: sourceId,
        artistName: source.label,
        challengeDate,
        includeFeatures,
        sourceType: source.sourceType,
        totalRounds,
        ranked,
      })
      .returning();
    const inserted = insertedRows[0];
    if (!inserted) throw new Error('Failed to create the artist challenge');
    challenge = inserted;
  } catch {
    // Lost a race with a concurrent request creating the same (source, date, includeFeatures)
    // challenge — the row now exists, so just read it back instead of failing the request.
    const raced = await findChallenge(sourceId, challengeDate, includeFeatures);
    if (!raced) throw new Error('Failed to create or find the artist challenge');
    return { challenge: raced, tracks: await loadChallengeTracks(raced.id) };
  }

  await db.insert(artistChallengeTracks).values(
    chosen.map((track, position) => ({
      challengeId: challenge.id,
      position,
      deezerTrackId: track.deezerTrackId,
      title: track.title,
      artist: track.artist,
      albumArtUrl: track.albumArtUrl,
      durationSeconds: track.durationSeconds,
      releaseYear: track.releaseYear ?? null,
    })),
  );

  return { challenge, tracks: await loadChallengeTracks(challenge.id) };
}

export async function getOrCreateArtistChallenge(
  artistId: number,
  challengeDate: string,
  includeFeatures = false,
): Promise<ArtistChallengeWithTracks> {
  return getOrCreateChallenge(await resolveArtistSource(artistId, includeFeatures), challengeDate);
}

async function findSessionResult(challengeId: number, identity: Identity) {
  if (identity.userId) {
    const rows = await db
      .select()
      .from(artistSessionResults)
      .where(
        and(
          eq(artistSessionResults.challengeId, challengeId),
          eq(artistSessionResults.userId, identity.userId),
        ),
      )
      .limit(1);
    return rows[0];
  }
  const rows = await db
    .select()
    .from(artistSessionResults)
    .where(
      and(
        eq(artistSessionResults.challengeId, challengeId),
        eq(artistSessionResults.guestId, identity.guestId ?? ''),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function getOrCreateSessionProgress(
  challengeId: number,
  identity: Identity,
): Promise<ArtistSessionResult> {
  const existing = await findSessionResult(challengeId, identity);
  if (existing) return existing;

  const rows = await db
    .insert(artistSessionResults)
    .values({
      challengeId,
      userId: identity.userId,
      guestId: identity.userId ? null : identity.guestId,
    })
    .returning();
  const session = rows[0];
  if (!session) throw new Error('Failed to create the artist session');
  return session;
}

/**
 * An artist source that never touches Deezer.
 *
 * `resolveArtistSource` fetches the artist to get their name and picture, which the paths below
 * don't use — and making them depend on that would mean an in-progress game breaks whenever
 * Deezer is rate-limiting us. The catalog is still lazy, so the one caller that does need it
 * (substituting a dead track) pays for it only when that actually happens.
 */
function artistSourceLite(artistId: number, includeFeatures: boolean): ChallengeSource {
  return {
    sourceType: 'artist',
    sourceId: String(artistId),
    label: '',
    pictureUrl: null,
    answerIsTitle: false,
    includeFeatures,
    loadCatalog: () => getArtistCatalog(artistId, includeFeatures),
  };
}

export async function getActiveSessionForSource(
  source: ChallengeSource,
  identity: Identity,
): Promise<{ session: ArtistSessionResult; challenge: ArtistChallenge } | null> {
  const rows = await db
    .select({
      session: artistSessionResults,
      challenge: artistChallenges,
    })
    .from(artistSessionResults)
    .innerJoin(artistChallenges, eq(artistChallenges.id, artistSessionResults.challengeId))
    .where(
      and(
        eq(artistChallenges.deezerArtistId, source.sourceId),
        eq(artistChallenges.includeFeatures, source.includeFeatures),
        eq(artistSessionResults.completed, false),
        identity.userId
          ? eq(artistSessionResults.userId, identity.userId)
          : eq(artistSessionResults.guestId, identity.guestId ?? ''),
      ),
    )
    .orderBy(desc(artistSessionResults.id))
    .limit(1);

  return rows[0] ?? null;
}

export async function getActiveSession(
  artistId: number,
  includeFeatures: boolean,
  identity: Identity,
): Promise<{ session: ArtistSessionResult; challenge: ArtistChallenge } | null> {
  return getActiveSessionForSource(artistSourceLite(artistId, includeFeatures), identity);
}

export interface ActiveSessionWithChallengeAndTracks {
  session: ArtistSessionResult;
  challenge: ArtistChallenge;
  tracks: ArtistChallengeTrack[];
}

export async function getSessionOrStartNew(
  source: ChallengeSource,
  identity: Identity,
  playAgain = false,
  /** If set, load this specific challenge (shared link flow) rather than the player's most recent one. */
  sharedChallengeId?: number,
  /** If set, use this exact date string instead of generating a UUID-suffixed one. Used by the
   *  daily challenge so every player shares the same challenge for a given calendar day. */
  fixedChallengeDate?: string,
): Promise<ActiveSessionWithChallengeAndTracks> {
  // Shared-link flow: load a specific challenge by ID, create a fresh session for this player if needed.
  if (sharedChallengeId != null && !playAgain) {
    const sharedRows = await db
      .select()
      .from(artistChallenges)
      .where(eq(artistChallenges.id, sharedChallengeId))
      .limit(1);
    const sharedChallenge = sharedRows[0];
    // The id has to belong to *this* source, not merely exist. Without both checks, a shared
    // link could be pointed at any challenge in the database, letting a player load a category
    // run through an artist URL (and land its score on the wrong board).
    if (
      !sharedChallenge ||
      sharedChallenge.deezerArtistId !== source.sourceId ||
      sharedChallenge.sourceType !== source.sourceType
    ) {
      throw new Error('Shared challenge not found');
    }
    const session = await getOrCreateSessionProgress(sharedChallenge.id, identity);
    const tracks = await loadChallengeTracks(sharedChallenge.id);
    return { session, challenge: sharedChallenge, tracks };
  }

  // If not explicitly requesting a new challenge, look for the most recent session.
  //
  // An *in-progress* run is always resumed, and that is a scoring rule rather than a
  // convenience: if leaving and coming back dealt a new hand, a player stuck on a hard song
  // could reroll until the draw was easy, and every leaderboard entry would be the best of
  // however many attempts someone was willing to sit through. Resuming makes the run you
  // started the run you are scored on.
  //
  // A *completed* run is not resumed — the next visit gets fresh songs, so finishing doesn't
  // strand the player on their old results screen. There is nothing to reroll at that point;
  // the score is already banked. (The daily challenge is the exception and takes a separate
  // path: replaying the same shared puzzle is the entire point of it.)
  if (!playAgain) {
    const existingRows = await db
      .select({
        session: artistSessionResults,
        challenge: artistChallenges,
      })
      .from(artistSessionResults)
      .innerJoin(artistChallenges, eq(artistChallenges.id, artistSessionResults.challengeId))
      .where(
        and(
          eq(artistChallenges.deezerArtistId, source.sourceId),
          eq(artistChallenges.includeFeatures, source.includeFeatures),
          identity.userId
            ? eq(artistSessionResults.userId, identity.userId)
            : eq(artistSessionResults.guestId, identity.guestId ?? ''),
        ),
      )
      .orderBy(desc(artistSessionResults.id))
      .limit(1);
    const existing = existingRows[0];

    if (existing && !existing.session.completed) {
      const tracks = await loadChallengeTracks(existing.challenge.id);
      return {
        session: existing.session,
        challenge: existing.challenge,
        tracks,
      };
    }
    // Completed session found — fall through to create a fresh challenge with new songs.
  }

  const challengeDate =
    fixedChallengeDate ?? `${new Date().toISOString().split('T')[0]}_${crypto.randomUUID()}`;
  const { challenge, tracks } = await getOrCreateChallenge(source, challengeDate);
  const session = await getOrCreateSessionProgress(challenge.id, identity);

  return {
    session,
    challenge,
    tracks,
  };
}

export async function getActiveSessionOrStartNew(
  artistId: number,
  includeFeatures: boolean,
  identity: Identity,
  playAgain = false,
  sharedChallengeId?: number,
): Promise<ActiveSessionWithChallengeAndTracks> {
  return getSessionOrStartNew(
    await resolveArtistSource(artistId, includeFeatures),
    identity,
    playAgain,
    sharedChallengeId,
  );
}

export interface RoundResultUpdate {
  sessionComplete: boolean;
  songsCorrect: number;
  totalGuessesUsed: number;
  timeTakenSeconds: number | null;
  totalRounds: number;
}

export async function recordArtistRoundResult(
  sessionId: number,
  correct: boolean,
  guessesUsed: number,
  snippetStageSeconds: number,
): Promise<RoundResultUpdate> {
  const sessionRows = await db
    .select()
    .from(artistSessionResults)
    .where(eq(artistSessionResults.id, sessionId))
    .limit(1);
  const session = sessionRows[0];
  if (!session) {
    throw new Error('Artist session not found');
  }

  const position = session.currentRound;

  await db.insert(artistRoundGuesses).values({
    sessionId,
    position,
    correct,
    snippetStageSeconds,
  });

  // Read from the challenge, not from the setting: shortening a run from 20 to 10 must not
  // strand everyone mid-way through a 20-song challenge that can never reach its last round.
  const challengeRows = await db
    .select({ totalRounds: artistChallenges.totalRounds })
    .from(artistChallenges)
    .where(eq(artistChallenges.id, session.challengeId))
    .limit(1);
  const totalRounds = challengeRows[0]?.totalRounds ?? ARTIST_CHALLENGE_SIZE;

  const isLastRound = session.currentRound >= totalRounds - 1;
  const songsCorrect = session.songsCorrect + (correct ? 1 : 0);
  const totalGuessesUsed = session.totalGuessesUsed + guessesUsed;

  // Compute wall-clock time on completion: seconds from session creation to now.
  const timeTakenSeconds = isLastRound
    ? Math.round((Date.now() - session.createdAt.getTime()) / 1000)
    : null;

  await db
    .update(artistSessionResults)
    .set({
      songsCorrect,
      totalGuessesUsed,
      currentRound: isLastRound ? session.currentRound : session.currentRound + 1,
      completed: isLastRound,
      timeTakenSeconds: timeTakenSeconds ?? undefined,
      updatedAt: new Date(),
    })
    .where(eq(artistSessionResults.id, sessionId));

  return {
    sessionComplete: isLastRound,
    songsCorrect,
    totalGuessesUsed,
    timeTakenSeconds,
    totalRounds,
  };
}

/** Random (non-deterministic) shuffle — used for multiple-choice option ordering/decoy pick,
 * where unlike track *selection for the challenge* there's no need for repeatable output. */
function shuffle<T>(items: readonly T[]): T[] {
  const result = [...items];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    const temp = result[i]!;
    result[i] = result[j]!;
    result[j] = temp;
  }
  return result;
}

/** Abandoned challenges older than this are collected. Long enough that a shared link still
 *  works for a week even if nobody has opened it yet. */
export const ABANDONED_CHALLENGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Deletes challenges nobody ever played a round of. Returns how many were removed.
 *
 * Opening an artist always starts a fresh challenge — that is the point, so an abandoned
 * half-run is never resumed — but it also means every visit writes a challenge row plus ten
 * track rows plus a session row, including visits where the player immediately backs out.
 * Without this, browsing artists grows the database indefinitely for runs nobody played.
 *
 * Only challenges where *no* session got past round zero are eligible, so anything with real
 * play behind it (and therefore leaderboard standings) is kept regardless of age. The
 * cascading foreign keys clear the track and session rows.
 */
export async function evictAbandonedChallenges(ttlMs?: number): Promise<number> {
  const effectiveTtl =
    ttlMs ?? (await getSettings()).abandonedChallengeTtlDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - effectiveTtl);

  const removed = await db
    .delete(artistChallenges)
    .where(
      and(
        lt(artistChallenges.createdAt, cutoff),
        notExists(
          db
            .select({ one: sql`1` })
            .from(artistSessionResults)
            .where(
              and(
                eq(artistSessionResults.challengeId, artistChallenges.id),
                or(
                  gt(artistSessionResults.currentRound, 0),
                  eq(artistSessionResults.completed, true),
                ),
              ),
            ),
        ),
      ),
    )
    .returning({ id: artistChallenges.id });

  if (removed.length > 0) {
    logger.info({ removed: removed.length, cutoff }, 'Evicted abandoned artist challenges');
  }
  return removed.length;
}

const CHALLENGE_SWEEP_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Runs the abandoned-challenge sweep at startup and daily after. Unref'd so it never holds
 *  the process open during shutdown. */
export function startAbandonedChallengeEviction(): NodeJS.Timeout {
  const sweep = (): void => {
    void evictAbandonedChallenges().catch((err) =>
      logger.error({ err }, 'Abandoned challenge eviction failed'),
    );
  };

  sweep();
  const timer = setInterval(sweep, CHALLENGE_SWEEP_INTERVAL_MS);
  timer.unref();
  return timer;
}

/** How many replacement candidates to try before giving up on a dead challenge slot. */
const SUBSTITUTION_ATTEMPTS = 5;

/**
 * Resolves a playable preview for a challenge round, repairing the challenge if the stored
 * track has gone dead.
 *
 * A track can pass catalog filtering (Deezer's album listing advertises a preview) and still
 * return no preview from the per-track endpoint — licensing and regional availability differ
 * between the two. That used to 503 the request, and because the dead track stays pinned at
 * its position, the challenge was bricked at that round forever: every retry hit the same
 * track. Here the slot is instead rewritten in place with another track from the artist's
 * catalog that isn't already in the challenge, so the player keeps a full ten rounds and the
 * fix persists for everyone else playing the same shared challenge.
 */
export async function resolvePlayableRoundForSource(
  track: ArtistChallengeTrack,
  source: ChallengeSource,
  usedTrackIds: readonly string[],
): Promise<{ track: ArtistChallengeTrack; previewUrl: string } | null> {
  /*
   * Guess the Movie stores the *song* in `artist` ("Katiya Karun · Harshdeep Kaur"), because
   * `title` holds the film — the answer. Refreshing that column from Deezer would replace it
   * with a contributor list ("Harshdeep Kaur, A.R. Rahman") and throw away the only thing the
   * reveal has to say which song was playing. The refresh exists to keep real artist names
   * current, which is not what this column means for these sources.
   */
  const refreshArtist = !source.answerIsTitle;

  const direct = await getFreshPreviewUrl(track.deezerTrackId);
  if (direct) {
    if (refreshArtist && direct.artist && direct.artist !== track.artist) {
      await db
        .update(artistChallengeTracks)
        .set({ artist: direct.artist })
        .where(eq(artistChallengeTracks.id, track.id));
    }
    const resolved = refreshArtist && direct.artist ? { ...track, artist: direct.artist } : track;
    return { track: resolved, previewUrl: direct.previewUrl };
  }

  logger.warn(
    { deezerTrackId: track.deezerTrackId, title: track.title },
    'Challenge track has no playable preview; substituting',
  );

  const pool = await source.loadCatalog();
  const excluded = new Set(usedTrackIds);
  const candidates = shuffle(pool.filter((t) => !excluded.has(t.deezerTrackId)));

  for (const candidate of candidates.slice(0, SUBSTITUTION_ATTEMPTS)) {
    const fresh = await getFreshPreviewUrl(candidate.deezerTrackId);
    if (!fresh) continue;

    const updatedRows = await db
      .update(artistChallengeTracks)
      .set({
        deezerTrackId: candidate.deezerTrackId,
        title: candidate.title,
        // Same reasoning: the pool's label is authoritative for movie sources.
        artist: (refreshArtist ? fresh.artist : null) ?? candidate.artist,
        albumArtUrl: candidate.albumArtUrl,
        durationSeconds: candidate.durationSeconds,
      })
      .where(eq(artistChallengeTracks.id, track.id))
      .returning();

    const updated = updatedRows[0];
    if (updated) return { track: updated, previewUrl: fresh.previewUrl };
  }

  return null;
}

export async function resolvePlayableRound(
  track: ArtistChallengeTrack,
  artistId: number,
  includeFeatures: boolean,
  usedTrackIds: readonly string[],
): Promise<{ track: ArtistChallengeTrack; previewUrl: string } | null> {
  return resolvePlayableRoundForSource(
    track,
    artistSourceLite(artistId, includeFeatures),
    usedTrackIds,
  );
}

export interface RoundOption {
  deezerTrackId: string;
  title: string;
  artist: string;
}

/**
 * Shuffled multiple-choice options for a round: the correct track plus decoys drawn from the
 * wider candidate pool (the artist's full top-tracks list), not just the other 9 tracks in
 * today's challenge. Two things this fixes: (1) decoys are deduplicated by normalized title
 * against the correct answer, so a near-duplicate version (e.g. two entries that normalize to
 * the same title) can never silently replace the "correct" button with a second copy of
 * itself; (2) drawing from a larger pool means decoys don't always come from the same fixed 10
 * songs, which was giving away information across rounds.
 *
 * `optionCount` is the total shown including the answer. Single-player runs use three;
 * Multiplayer asks for four, where everyone races the same snippet and a one-in-three guess
 * lands too often to separate the field.
 */
export function buildRoundOptions(
  correct: { deezerTrackId: string; title: string; artist: string },
  candidatePool: readonly ArtistTrack[],
  optionCount = 3,
  /**
   * Blanks the artist line on every option. Set for Guess the Movie, where `title` is the film
   * and `artist` is the song that is playing right now — showing it would hand the answer to
   * anyone who recognises the track, which is a different (and much easier) question than the
   * one the mode asks. Deduping decoys by title also means no two options are the same film.
   */
  hideArtist = false,
): RoundOption[] {
  const correctNormalized = normalizeTitle(correct.title);
  const seen = new Set<string>([correctNormalized]);

  const decoyCandidates = candidatePool.filter((t) => {
    if (t.deezerTrackId === correct.deezerTrackId) return false;
    const normalized = normalizeTitle(t.title);
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });

  // When the pool is a merge of several categories (see mergeCatalogs), keep decoys from the
  // same one the answer came from - a pool spanning categories isn't necessarily one language,
  // and mixed-language options make the answer guessable without knowing the song. Falls back
  // to the whole pool for a single-category/artist run (untagged) or if that category alone
  // can't fill every decoy slot.
  const correctCategoryId = candidatePool.find(
    (t) => t.deezerTrackId === correct.deezerTrackId,
  )?.categoryId;
  const sameOriginDecoys = correctCategoryId
    ? decoyCandidates.filter((t) => t.categoryId === correctCategoryId)
    : decoyCandidates;
  const decoyPool = sameOriginDecoys.length >= optionCount - 1 ? sameOriginDecoys : decoyCandidates;

  const decoys = shuffle(decoyPool)
    .slice(0, Math.max(1, optionCount - 1))
    .map((t) => ({
      deezerTrackId: t.deezerTrackId,
      title: t.title,
      artist: hideArtist ? '' : t.artist,
    }));

  return shuffle([
    {
      deezerTrackId: correct.deezerTrackId,
      title: correct.title,
      artist: hideArtist ? '' : correct.artist,
    },
    ...decoys,
  ]);
}

export interface ArtistLeaderboardEntry {
  rank: number;
  displayName: string;
  songsCorrect: number;
  /** The length of the run this score came from — runs are not all the same length once the
   *  admin changes the setting, so "8 correct" is meaningless without it. */
  totalRounds: number;
  totalGuessesUsed: number;
  timeTakenSeconds: number | null;
  isYou: boolean;
}

interface LeaderboardRow {
  ownerKey: string;
  displayName: string | null;
  songsCorrect: number;
  totalRounds: number;
  totalGuessesUsed: number;
  timeTakenSeconds: number | null;
}

/** Guests are excluded upstream, so every row here belongs to a registered account — the
 *  'Guest' fallback below only guards against a null display_name, never anonymity. */
function buildLeaderboardEntries(rows: LeaderboardRow[], myKey: string): ArtistLeaderboardEntry[] {
  return rows.map((row, index) => ({
    rank: index + 1,
    displayName: row.displayName ?? 'Guest',
    songsCorrect: row.songsCorrect,
    totalRounds: row.totalRounds,
    totalGuessesUsed: row.totalGuessesUsed,
    timeTakenSeconds: row.timeTakenSeconds,
    isYou: row.ownerKey === myKey,
  }));
}

export interface SourceStanding {
  rank: number;
  displayName: string;
  /** Completed runs for this artist/category. */
  runs: number;
  songsCorrect: number;
  songsPossible: number;
  accuracy: number;
  bestRun: number;
  averageTimeSeconds: number | null;
  fastestRunSeconds: number | null;
  isYou: boolean;
}

export interface SourceLeaderboard {
  entries: SourceStanding[];
  /** The caller's own totals, shown even when they are a guest and therefore unranked. */
  mine: Omit<SourceStanding, 'rank' | 'displayName' | 'isYou'> | null;
}

interface StandingRow {
  ownerKey: string;
  displayName: string | null;
  runs: number;
  songsCorrect: number;
  songsPossible: number;
  bestRun: number;
  avgTime: string | null;
  fastestRun: number | null;
}

function toStanding(row: StandingRow, index: number, myKey: string): SourceStanding {
  return {
    rank: index + 1,
    displayName: row.displayName ?? 'Player',
    runs: row.runs,
    songsCorrect: row.songsCorrect,
    songsPossible: row.songsPossible,
    accuracy: row.songsPossible > 0 ? Math.round((row.songsCorrect / row.songsPossible) * 100) : 0,
    bestRun: row.bestRun,
    // AVG returns numeric, which postgres-js hands back as a string — parse rather than trust
    // the row type, which is only an assertion.
    averageTimeSeconds: row.avgTime == null ? null : Math.round(Number(row.avgTime)),
    fastestRunSeconds: row.fastestRun,
    isYou: row.ownerKey === myKey,
  };
}

/** The aggregate columns, shared by the ranked board and the caller's own row so the two can
 *  never disagree about what "your total" means. */
const STANDING_COLUMNS = sql`
  COUNT(*)::int                              AS "runs",
  COALESCE(SUM(r.songs_correct), 0)::int     AS "songsCorrect",
  COALESCE(SUM(c.total_rounds), 0)::int      AS "songsPossible",
  COALESCE(MAX(r.songs_correct), 0)::int     AS "bestRun",
  AVG(r.time_taken_seconds)                  AS "avgTime",
  MIN(r.time_taken_seconds)::int             AS "fastestRun"
`;

/**
 * Standings for one artist or category, ranked by cumulative play rather than a single best run.
 *
 * Best-of ranking rewarded whoever replayed most: every visit builds a freshly randomized
 * challenge, so a player could keep rolling until they drew ten singles instead of ten deep cuts
 * and bank that one lucky run forever. Totals remove the incentive — there is no draw worth
 * fishing for when every run counts — and they are also fair across *different* draws in a way
 * single-run comparison never was, because variance averages out over a player's history.
 *
 * Ties break toward the player who needed fewer guesses, then the faster one.
 *
 * Scoped by `source_type` as well as id. Slugs and numeric artist ids cannot collide today, but
 * relying on that would make the board silently wrong the first time a category is ever named
 * with digits — and the intent (one board per mode) is worth stating in the query.
 */
export async function getSourceLeaderboard(
  sourceType: ChallengeSourceType,
  sourceId: string,
  identity: Identity,
  limit = 20,
): Promise<SourceLeaderboard> {
  const rows = (await db.execute(sql`
    SELECT
      COALESCE(r.user_id, r.guest_id) AS "ownerKey",
      u.display_name                  AS "displayName",
      ${STANDING_COLUMNS}
    FROM artist_session_results r
    JOIN artist_challenges c ON c.id = r.challenge_id
    JOIN users u ON u.id = r.user_id
    -- Short unranked runs are excluded: comparable scores need comparable lengths.
    WHERE c.ranked = true AND c.deezer_artist_id = ${sourceId}
      AND c.source_type = ${sourceType}
      AND r.completed = true
      AND r.user_id IS NOT NULL
    GROUP BY COALESCE(r.user_id, r.guest_id), u.display_name
    ORDER BY
      "songsCorrect" DESC,
      COALESCE(SUM(r.total_guesses_used), 0) ASC,
      AVG(r.time_taken_seconds) ASC NULLS LAST
    LIMIT ${limit}
  `)) as unknown as StandingRow[];

  const myKey = identity.userId ?? identity.guestId ?? '';
  const entries = rows.map((row, index) => toStanding(row, index, myKey));

  // Guests never appear on the board, but they still see their own totals — the result screen
  // would otherwise show them nothing at all about an artist they have played for weeks.
  const mineRows = (await db.execute(sql`
    SELECT ${STANDING_COLUMNS}
    FROM artist_session_results r
    JOIN artist_challenges c ON c.id = r.challenge_id
    -- Short unranked runs are excluded: comparable scores need comparable lengths.
    WHERE c.ranked = true AND c.deezer_artist_id = ${sourceId}
      AND c.source_type = ${sourceType}
      AND r.completed = true
      AND COALESCE(r.user_id, r.guest_id) = ${myKey}
  `)) as unknown as Omit<StandingRow, 'ownerKey' | 'displayName'>[];

  // There is no GROUP BY above, so this aggregate always returns exactly one row — with zero
  // runs when the player has never finished one, which is not a standing worth showing.
  const mineRow = mineRows[0];
  const mine =
    mineRow && mineRow.runs > 0
      ? {
          runs: mineRow.runs,
          songsCorrect: mineRow.songsCorrect,
          songsPossible: mineRow.songsPossible,
          accuracy:
            mineRow.songsPossible > 0
              ? Math.round((mineRow.songsCorrect / mineRow.songsPossible) * 100)
              : 0,
          bestRun: mineRow.bestRun,
          averageTimeSeconds: mineRow.avgTime == null ? null : Math.round(Number(mineRow.avgTime)),
          fastestRunSeconds: mineRow.fastestRun,
        }
      : null;

  return { entries, mine };
}

/** Global per-artist standings — see `getSourceLeaderboard` for how they are ranked. */
export async function getArtistLeaderboard(
  artistId: number,
  identity: Identity,
  limit = 20,
): Promise<SourceLeaderboard> {
  return getSourceLeaderboard('artist', String(artistId), identity, limit);
}

/** Per-challenge leaderboard — everyone who played a specific shared challenge. */
export async function getChallengeLeaderboard(
  challengeId: number,
  identity: Identity,
  limit = 20,
): Promise<{ entries: ArtistLeaderboardEntry[] }> {
  const rows = (await db.execute(sql`
    SELECT
      COALESCE(r.user_id, r.guest_id) as "ownerKey",
      u.display_name as "displayName",
      r.songs_correct as "songsCorrect",
      c.total_rounds as "totalRounds",
      r.total_guesses_used as "totalGuessesUsed",
      r.time_taken_seconds as "timeTakenSeconds"
    FROM artist_session_results r
    JOIN artist_challenges c ON c.id = r.challenge_id
    JOIN users u ON u.id = r.user_id
    WHERE r.challenge_id = ${challengeId}
      AND r.completed = true
      AND r.user_id IS NOT NULL
    ORDER BY "songsCorrect" DESC, "timeTakenSeconds" ASC NULLS LAST, "totalGuessesUsed" ASC
    LIMIT ${limit}
  `)) as unknown as LeaderboardRow[];

  const myKey = identity.userId ?? identity.guestId ?? '';
  return { entries: buildLeaderboardEntries(rows, myKey) };
}

export interface GuessDistributionBucket {
  snippetSeconds: number;
  label: string;
  allPlayers: number;
  myGuesses: number;
}

export async function getSourceGuessDistribution(
  sourceType: ChallengeSourceType,
  sourceId: string,
  identity: Identity,
): Promise<GuessDistributionBucket[]> {
  // The `::int` casts are load-bearing. Postgres COUNT(*) is bigint, which postgres-js returns
  // as a *string* to avoid precision loss, and the row type assertion below cannot catch that.
  // The client then summed the buckets with `+`, concatenating instead of adding — the legend
  // read "All players (01800000)" and the average divided by that, showing "avg 0.0s".

  const allRows = (await db.execute(sql`
    SELECT g.snippet_stage_seconds as "snippetStageSeconds", COUNT(*)::int as count
    FROM artist_round_guesses g
    JOIN artist_session_results s ON s.id = g.session_id
    JOIN artist_challenges c ON c.id = s.challenge_id
    -- Short unranked runs are excluded: comparable scores need comparable lengths.
    WHERE c.ranked = true AND c.deezer_artist_id = ${sourceId}
      AND c.source_type = ${sourceType}
      AND s.completed = true
      AND g.correct = true
    GROUP BY g.snippet_stage_seconds
  `)) as unknown as { snippetStageSeconds: number; count: number }[];

  const myRows = (await db.execute(sql`
    SELECT g.snippet_stage_seconds as "snippetStageSeconds", COUNT(*)::int as count
    FROM artist_round_guesses g
    JOIN artist_session_results s ON s.id = g.session_id
    JOIN artist_challenges c ON c.id = s.challenge_id
    -- Short unranked runs are excluded: comparable scores need comparable lengths.
    WHERE c.ranked = true AND c.deezer_artist_id = ${sourceId}
      AND c.source_type = ${sourceType}
      AND s.completed = true
      AND g.correct = true
      AND COALESCE(s.user_id, s.guest_id) = ${identity.userId ?? identity.guestId ?? ''}
    GROUP BY g.snippet_stage_seconds
  `)) as unknown as { snippetStageSeconds: number; count: number }[];

  const allMap = new Map(allRows.map((r) => [r.snippetStageSeconds, r.count]));
  const myMap = new Map(myRows.map((r) => [r.snippetStageSeconds, r.count]));

  const stages = [1, 2, 4, 7, 11, 16];
  return stages.map((s) => ({
    snippetSeconds: s,
    label: `${s}s`,
    allPlayers: allMap.get(s) ?? 0,
    myGuesses: myMap.get(s) ?? 0,
  }));
}

export async function getArtistGuessDistribution(
  artistId: number,
  identity: Identity,
): Promise<GuessDistributionBucket[]> {
  return getSourceGuessDistribution('artist', String(artistId), identity);
}

export interface ChallengeSummary {
  challengeId: number;
  sourceType: ChallengeSourceType;
  label: string;
  totalRounds: number;
  /**
   * The score to beat: the first person to finish this challenge, which for a shared link is
   * whoever sent it. Null when nobody has completed it yet, including when the sender shared
   * the link before finishing their own run.
   */
  challenger: {
    displayName: string;
    songsCorrect: number;
    totalGuessesUsed: number;
    timeTakenSeconds: number | null;
  } | null;
}

/**
 * Who set the mark on a shared challenge.
 *
 * Ordered by completion, not by score: a duel is against the person who sent you the link, and
 * showing whoever happens to be leading would quietly change the opponent underneath you.
 * Guests are eligible here, unlike the leaderboards — the sender is identified by the link they
 * gave you, so there is nothing to attribute or rank.
 */
export async function getChallengeSummary(challengeId: number): Promise<ChallengeSummary | null> {
  const rows = await db
    .select()
    .from(artistChallenges)
    .where(eq(artistChallenges.id, challengeId))
    .limit(1);
  const challenge = rows[0];
  if (!challenge) return null;

  const firstFinisher = (await db.execute(sql`
    SELECT
      COALESCE(u.display_name, 'A friend') AS "displayName",
      r.songs_correct                      AS "songsCorrect",
      r.total_guesses_used                 AS "totalGuessesUsed",
      r.time_taken_seconds                 AS "timeTakenSeconds"
    FROM artist_session_results r
    LEFT JOIN users u ON u.id = r.user_id
    WHERE r.challenge_id = ${challengeId} AND r.completed = true
    ORDER BY r.updated_at ASC
    LIMIT 1
  `)) as unknown as ChallengeSummary['challenger'][];

  return {
    challengeId: challenge.id,
    sourceType: challenge.sourceType as ChallengeSourceType,
    label: challenge.artistName,
    totalRounds: challenge.totalRounds,
    challenger: firstFinisher[0] ?? null,
  };
}
