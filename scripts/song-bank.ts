/**
 * The song bank pipeline. Song data lives in data/song-bank, apart from game logic.
 *
 *   build     seeds.json + Deezer -> songs.json (resumable; responses cached in .cache/)
 *   validate  checks songs.json, then asks Deezer that every track still has a playable preview
 *   import    upserts songs.json into DATABASE_URL. Never deletes, keeps existing ids
 *   report    reads the actual database and writes docs/SONG-BANK.md
 *
 * Only build and validate call Deezer. Preview links are signed and expire in minutes, so the
 * manifest stores no URLs that matter; the game resolves a fresh one at play time.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isUnwantedVersion,
  normalizeTitle,
  stripVersionSuffix,
} from '../apps/server/src/utils/trackFilters';
import { buildAliases, foldForSearch } from '../apps/server/src/utils/songAliases';

interface Scene {
  id: string;
  label: string;
  genre: string;
  language: string;
  region: string;
  edition: 'english' | 'desi' | null;
  perArtist: number;
  minRank: number;
  artists: string[];
}

export interface BankSong {
  deezerTrackId: string;
  title: string;
  artist: string;
  featuredArtists: string[];
  album: string | null;
  releaseYear: number | null;
  genre: string;
  scene: string;
  language: string;
  region: string;
  dailyEdition: 'english' | 'desi' | null;
  albumArtUrl: string | null;
  durationSeconds: number;
  difficulty: number;
  rank: number;
  isrc: string | null;
  aliases: string[];
}

interface DeezerTrack {
  id: number;
  title: string;
  title_version?: string;
  duration: number;
  rank: number;
  preview: string;
  isrc?: string;
  release_date?: string;
  readable?: boolean;
  artist: { id: number; name: string };
  contributors?: { id: number; name: string; role?: string }[];
  album?: { id: number; title: string; cover_medium?: string; release_date?: string };
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dir = resolve(root, 'data/song-bank');
const cacheDir = resolve(dir, '.cache');
const seedsPath = resolve(dir, 'seeds.json');
const songsPath = resolve(dir, 'songs.json');
const reportPath = resolve(root, 'docs/SONG-BANK.md');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deezer allows about 50 calls per 5 seconds and reports overuse as a 200 with an error body. */
async function deezer<T>(path: string, cache = true): Promise<T> {
  const file = resolve(cacheDir, `${createHash('sha1').update(path).digest('hex')}.json`);
  if (cache && existsSync(file)) return JSON.parse(readFileSync(file, 'utf-8')) as T;

  for (let attempt = 0; attempt < 6; attempt += 1) {
    await sleep(120);
    const res = await fetch(`https://api.deezer.com${path}`);
    if (!res.ok) {
      await sleep(1000 * (attempt + 1));
      continue;
    }
    const body = (await res.json()) as T & { error?: { message?: string } };
    if (body.error?.message?.toLowerCase().includes('quota')) {
      await sleep(5000);
      continue;
    }
    if (cache && !body.error) writeFileSync(file, JSON.stringify(body));
    return body;
  }
  throw new Error(`Deezer kept failing for ${path}`);
}

/** Exact name only: a near match puts another artist's songs in the wrong scene. */
async function findArtist(name: string): Promise<{ id: number; name: string } | null> {
  const body = await deezer<{ data?: { id: number; name: string; nb_fan?: number }[] }>(
    `/search/artist?q=${encodeURIComponent(name)}&limit=10`,
  );
  const wanted = foldForSearch(name);
  return body.data?.find((a) => foldForSearch(a.name) === wanted) ?? null;
}

function songKey(title: string, artist: string): string {
  // Parentheticals go too: Male/Female takes, Part 2 and From "Film" are the same song to a player.
  const bare = stripVersionSuffix(title).replace(/\s*[([].*$/, '');
  return `${foldForSearch(bare || title)}|${foldForSearch(artist)}`;
}

/** Popularity decides difficulty, within a scene: a famous ghazal and a famous pop hit both start at 1. */
function assignDifficulty(songs: BankSong[]): void {
  const byScene = new Map<string, BankSong[]>();
  for (const song of songs) byScene.set(song.scene, [...(byScene.get(song.scene) ?? []), song]);
  for (const group of byScene.values()) {
    group.sort((a, b) => b.rank - a.rank);
    group.forEach((song, i) => {
      song.difficulty = Math.min(5, Math.floor((i / group.length) * 5) + 1);
    });
  }
}

async function build(): Promise<void> {
  mkdirSync(cacheDir, { recursive: true });
  const { scenes, excludedArtists, extras } = JSON.parse(readFileSync(seedsPath, 'utf-8')) as {
    scenes: Scene[];
    excludedArtists: string[];
    extras: { scene: string; artist: string; title: string }[];
  };
  const excluded = new Set(excludedArtists.map(foldForSearch));
  const seeded = new Set(scenes.flatMap((s) => s.artists).map(foldForSearch));
  const byKey = new Map<string, BankSong>();
  const byIsrc = new Set<string>();
  const unresolved: string[] = [];
  const stats = { unwanted: 0, lowRank: 0, noPreview: 0, duplicate: 0 };

  for (const scene of scenes) {
    const before = byKey.size;
    for (const name of scene.artists) {
      const artist = await findArtist(name);
      if (!artist) {
        unresolved.push(`${scene.id}: ${name}`);
        continue;
      }
      // Ask for more than needed: filters and duplicates remove plenty.
      const top = await deezer<{ data?: DeezerTrack[] }>(`/artist/${artist.id}/top?limit=50`);
      let kept = 0;
      for (const listed of top.data ?? []) {
        if (kept >= scene.perArtist) break;
        if (isUnwantedVersion(listed.title)) {
          stats.unwanted += 1;
          continue;
        }
        if (listed.rank < scene.minRank) {
          stats.lowRank += 1;
          continue;
        }
        if (!listed.preview) {
          stats.noPreview += 1;
          continue;
        }
        const track = await deezer<DeezerTrack>(`/track/${listed.id}`);
        // The chart's artist field can be a collaborator; only credit the song to its primary artist.
        const primary = track.artist?.name;
        if (!primary || !track.title || !track.duration) continue;
        // Someone else's rework credited to this artist, like "We Ain't Gonna Stop (Ek Pal Ka Jeena)".
        const outsider = !seeded.has(foldForSearch(primary));
        if (excluded.has(foldForSearch(primary)) || (outsider && /[([]/.test(track.title))) {
          stats.unwanted += 1;
          continue;
        }
        const key = songKey(track.title, primary);
        const isrc = track.isrc || null;
        if (byKey.has(key) || (isrc && byIsrc.has(isrc))) {
          stats.duplicate += 1;
          continue;
        }
        const date = track.release_date ?? track.album?.release_date;
        const year = date ? Number(date.slice(0, 4)) : null;
        const featured = (track.contributors ?? [])
          .map((c) => c.name)
          .filter((n) => normalizeTitle(n) !== normalizeTitle(primary));
        byKey.set(key, {
          deezerTrackId: String(track.id),
          title: track.title,
          artist: primary,
          featuredArtists: [...new Set(featured)],
          album: track.album?.title ?? null,
          // Deezer's placeholder dates cluster on 1900 and 1970-01-01. Unknown beats wrong.
          releaseYear: year && year > 1900 && date !== '1970-01-01' ? year : null,
          genre: scene.genre,
          scene: scene.id,
          language: scene.language,
          region: scene.region,
          // Language is known per scene, so a daily answer must be by an artist we seeded there.
          dailyEdition: outsider && scene.edition === 'desi' ? null : scene.edition,
          albumArtUrl: track.album?.cover_medium ?? null,
          durationSeconds: track.duration,
          difficulty: 3,
          rank: track.rank,
          isrc,
          aliases: buildAliases(track.title, scene.language),
        });
        if (isrc) byIsrc.add(isrc);
        kept += 1;
      }
    }
    console.log(`${scene.id}: +${byKey.size - before} (total ${byKey.size})`);
  }

  // Songs top-track lists miss. Exact title and artist only, or nothing.
  for (const extra of extras) {
    const scene = scenes.find((s) => s.id === extra.scene);
    const found = await deezer<{ data?: DeezerTrack[] }>(
      `/search?q=${encodeURIComponent(`${extra.artist} ${extra.title}`)}&limit=10`,
    );
    const hit = found.data?.find(
      (t) =>
        foldForSearch(t.artist.name) === foldForSearch(extra.artist) &&
        foldForSearch(stripVersionSuffix(t.title).replace(/\s*[([].*$/, '')) ===
          foldForSearch(extra.title) &&
        !isUnwantedVersion(t.title) &&
        t.preview,
    );
    if (!scene || !hit) {
      unresolved.push(`extra: ${extra.artist} - ${extra.title}`);
      continue;
    }
    const track = await deezer<DeezerTrack>(`/track/${hit.id}`);
    const date = track.release_date ?? track.album?.release_date;
    byKey.set(songKey(track.title, track.artist.name), {
      deezerTrackId: String(track.id),
      title: track.title,
      artist: track.artist.name,
      featuredArtists: [],
      album: track.album?.title ?? null,
      releaseYear: date ? Number(date.slice(0, 4)) : null,
      genre: scene.genre,
      scene: scene.id,
      language: scene.language,
      region: scene.region,
      dailyEdition: scene.edition,
      albumArtUrl: track.album?.cover_medium ?? null,
      durationSeconds: track.duration,
      difficulty: 3,
      rank: track.rank,
      isrc: track.isrc || null,
      aliases: buildAliases(track.title, scene.language),
    });
  }

  const songs = [...byKey.values()];
  assignDifficulty(songs);
  songs.sort(
    (a, b) => a.scene.localeCompare(b.scene) || a.deezerTrackId.localeCompare(b.deezerTrackId),
  );
  writeFileSync(songsPath, `${JSON.stringify(songs, null, 1)}\n`);
  console.log(`\n${songs.length} songs written.`, stats);
  if (unresolved.length) console.log(`No exact artist match:\n  ${unresolved.join('\n  ')}`);
}

function loadSongs(): BankSong[] {
  return JSON.parse(readFileSync(songsPath, 'utf-8')) as BankSong[];
}

/** Pure, so a test can break it. Returns every problem found in the manifest. */
export function findManifestProblems(songs: BankSong[]): string[] {
  const problems: string[] = [];
  const ids = new Set<string>();
  const keys = new Set<string>();
  for (const s of songs) {
    const label = `${s.deezerTrackId} ${s.artist} - ${s.title}`;
    if (ids.has(s.deezerTrackId)) problems.push(`duplicate id: ${label}`);
    ids.add(s.deezerTrackId);
    const key = songKey(s.title, s.artist);
    if (keys.has(key)) problems.push(`duplicate song: ${label}`);
    keys.add(key);
    if (!s.title.trim() || !s.artist.trim()) problems.push(`missing title or artist: ${label}`);
    if (s.durationSeconds <= 0) problems.push(`bad duration: ${label}`);
    if (s.difficulty < 1 || s.difficulty > 5) problems.push(`bad difficulty: ${label}`);
    if (s.albumArtUrl && !s.albumArtUrl.startsWith('https://')) problems.push(`bad art: ${label}`);
    if (isUnwantedVersion(s.title)) problems.push(`alternate version: ${label}`);
  }
  return problems;
}

async function validate(): Promise<void> {
  const songs = loadSongs();
  const problems = findManifestProblems(songs);
  let dead = 0;
  // Live check: the track must still exist and hand out a preview that actually serves audio.
  for (const [i, song] of songs.entries()) {
    const live = await deezer<DeezerTrack & { error?: unknown }>(
      `/track/${song.deezerTrackId}`,
      false,
    );
    let ok = Boolean(live.preview) && !live.error;
    if (ok) {
      const head = await fetch(live.preview, { headers: { Range: 'bytes=0-1' } }).catch(() => null);
      ok = Boolean(head?.ok) && (head?.headers.get('content-type') ?? '').includes('audio');
      await head?.body?.cancel().catch(() => undefined);
    }
    if (!ok) {
      dead += 1;
      problems.push(`no playable preview: ${song.deezerTrackId} ${song.artist} - ${song.title}`);
    }
    if ((i + 1) % 250 === 0) console.log(`checked ${i + 1}/${songs.length}, ${dead} dead`);
  }
  console.log(`${songs.length} songs checked. ${problems.length} problems.`);
  for (const problem of problems) console.log(`  ${problem}`);
  writeFileSync(
    resolve(cacheDir, 'validate.json'),
    JSON.stringify({ at: new Date(), dead, problems }),
  );
  if (problems.length) process.exitCode = 1;
}

async function importBank(): Promise<void> {
  const { db, sqlClient } = await import('../apps/server/src/db/client');
  const { songs } = await import('../apps/server/src/db/schema');
  const { sql } = await import('drizzle-orm');
  const rows = loadSongs();
  for (let i = 0; i < rows.length; i += 200) {
    const batch = rows.slice(i, i + 200).map((s) => ({
      ...s,
      // Not playable as stored. Required by the column, replaced by a live lookup at play time.
      previewUrl: `https://api.deezer.com/track/${s.deezerTrackId}`,
      albumArtUrl: s.albumArtUrl,
      manualOverride: true,
      active: true,
    }));
    await db
      .insert(songs)
      .values(batch)
      .onConflictDoUpdate({
        target: songs.deezerTrackId,
        set: {
          title: sql`excluded.title`,
          artist: sql`excluded.artist`,
          featuredArtists: sql`excluded.featured_artists`,
          album: sql`excluded.album`,
          releaseYear: sql`excluded.release_year`,
          genre: sql`excluded.genre`,
          scene: sql`excluded.scene`,
          language: sql`excluded.language`,
          region: sql`excluded.region`,
          dailyEdition: sql`excluded.daily_edition`,
          albumArtUrl: sql`excluded.album_art_url`,
          durationSeconds: sql`excluded.duration_seconds`,
          difficulty: sql`excluded.difficulty`,
          rank: sql`excluded.rank`,
          isrc: sql`excluded.isrc`,
          aliases: sql`excluded.aliases`,
          active: true,
          manualOverride: true,
        },
      });
  }
  // A song the manifest no longer has leaves play but keeps its row: past puzzles reference it.
  const keep = rows.map((s) => s.deezerTrackId);
  const retired = await db
    .update(songs)
    .set({ active: false, dailyEdition: null, scene: null })
    .where(sql`${songs.scene} IS NOT NULL AND ${songs.deezerTrackId} NOT IN ${keep}`)
    .returning({ id: songs.id });
  console.log(`Retired ${retired.length} songs.`);
  console.log(`Upserted ${rows.length} songs.`);
  await sqlClient.end();
}

async function report(): Promise<void> {
  const { sqlClient: q } = await import('../apps/server/src/db/client');
  const table = async (title: string, column: string): Promise<string> => {
    const rows = await q.unsafe(
      `SELECT coalesce(${column}::text, '(none)') AS k, count(*)::int AS n FROM songs WHERE scene IS NOT NULL GROUP BY 1 ORDER BY 2 DESC`,
    );
    return `## ${title}\n\n| | Songs |\n|---|---:|\n${rows.map((r) => `| ${r.k} | ${r.n} |`).join('\n')}\n`;
  };
  const [{ total, artists }] = (await q`
    SELECT count(*)::int AS total, count(DISTINCT lower(artist))::int AS artists
    FROM songs WHERE scene IS NOT NULL`) as unknown as [{ total: number; artists: number }];
  const [missing] = await q`
    SELECT count(*) FILTER (WHERE album IS NULL)::int AS album,
           count(*) FILTER (WHERE release_year IS NULL)::int AS year,
           count(*) FILTER (WHERE album_art_url IS NULL)::int AS art,
           count(*) FILTER (WHERE isrc IS NULL)::int AS isrc
    FROM songs WHERE scene IS NOT NULL`;
  const dupes = await q`
    SELECT lower(title) AS t, lower(artist) AS a, count(*)::int AS n FROM songs
    WHERE scene IS NOT NULL GROUP BY 1, 2 HAVING count(*) > 1`;
  const isrcDupes = await q`
    SELECT isrc FROM songs WHERE isrc IS NOT NULL AND scene IS NOT NULL GROUP BY 1 HAVING count(*) > 1`;
  const top = await q`
    SELECT artist, count(*)::int AS n FROM songs WHERE scene IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 10`;
  const validation = existsSync(resolve(cacheDir, 'validate.json'))
    ? (JSON.parse(readFileSync(resolve(cacheDir, 'validate.json'), 'utf-8')) as {
        at: string;
        dead: number;
        problems: string[];
      })
    : null;

  const sections = [
    '# Song bank report',
    '',
    `Generated from the database by \`npm run song-bank report\`, ${new Date().toISOString().slice(0, 10)}.`,
    '',
    `- **Unique songs:** ${total}`,
    `- **Artists represented:** ${artists}`,
    `- **Missing metadata:** album ${missing?.album}, year ${missing?.year}, artwork ${missing?.art}, ISRC ${missing?.isrc}`,
    `- **Duplicates:** ${dupes.length} by title and artist, ${isrcDupes.length} by ISRC`,
    validation
      ? `- **Last live preview check:** ${validation.at.slice(0, 10)}, ${validation.dead} unplayable, ${validation.problems.length} problems in total`
      : '- **Last live preview check:** not run',
    `- **Most represented:** ${top.map((r) => `${r.artist} (${r.n})`).join(', ')}`,
    '',
    'Genre, language and region come from the scene an artist is seeded under in `seeds.json`; Deezer does not publish language. Everything else comes from Deezer. Karaoke, tribute, remix, live and acoustic versions are filtered out, in line with the game rule of originals only.',
    '',
    await table('Daily editions', 'daily_edition'),
    await table('Songs per scene', 'scene'),
    await table('Songs per genre', 'genre'),
    await table('Songs per language', 'language'),
    await table('Songs per region', 'region'),
    await table('Songs per decade', `(release_year / 10 * 10)`),
    await table('Songs per difficulty', 'difficulty'),
  ];
  writeFileSync(reportPath, sections.join('\n'));
  console.log(sections.slice(3, 10).join('\n'));
  await q.end();
}

const commands: Record<string, () => Promise<void>> = {
  build,
  validate,
  import: importBank,
  report,
};
const command = commands[process.argv[2] ?? ''];
if (command) {
  command().catch((err) => {
    console.error(err);
    process.exit(1);
  });
} else if (process.argv[1]?.endsWith('song-bank.ts')) {
  console.error(`Usage: song-bank <${Object.keys(commands).join('|')}>`);
  process.exitCode = 1;
}
