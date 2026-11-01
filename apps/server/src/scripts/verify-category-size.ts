/**
 * Reports the real, deduplicated, playable size of every category.
 *
 *   npx tsx apps/server/src/scripts/verify-category-size.ts                # all, read-only
 *   npx tsx apps/server/src/scripts/verify-category-size.ts year-2014      # one, with sample rows
 *   npx tsx apps/server/src/scripts/verify-category-size.ts --json out.json
 *
 * find-playlists.ts reports what each playlist *claims* to hold, which is the wrong number to
 * plan with: several lists all called "best of 2016" overlap heavily, and the pool builder drops
 * remixes, live cuts and duplicate songs on top of that. A category can look like 700 tracks in
 * search results and be 180 once merged.
 *
 * This applies the same filter and dedupe key the real pool builder uses, so the count it prints
 * is the count a player would actually draw from. "Playable" means Deezer returned a preview url,
 * and a sample of those urls is then fetched to confirm the audio really answers. Touches Deezer
 * and nothing else, so it is safe to run against a proposed set before any of it is committed.
 * Exits non-zero when a category is under target.
 */
import { writeFileSync } from 'node:fs';
import { CATEGORIES, type Category } from '../services/categories';
import {
  isUnwantedVersion,
  normalizeTitle,
  stripAnyTrailingQualifier,
} from '../utils/trackFilters';

const TARGET = 250;
const AUDIO_SAMPLE = 8;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** ~8 calls a second, under Deezer's 50 per 5 seconds, whatever the mix of categories. */
let lastCall = 0;
async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const wait = lastCall + 125 - Date.now();
    lastCall = Math.max(Date.now(), lastCall + 125);
    if (wait > 0) await sleep(wait);
    try {
      const res = await fetch(url, { headers: { Referer: 'https://chorusify.com/' } });
      const body = (await res.json()) as Record<string, unknown>;
      if (!body.error) return body;
    } catch {
      /* retried below */
    }
    await sleep(1500 * (attempt + 1) + Math.random() * 500);
  }
  return null;
}

interface Track {
  id: string;
  title: string;
  artist: string;
  preview: string | null;
}

type RawTrack = {
  id?: number;
  title?: string;
  preview?: string;
  artist?: { name?: string };
};

const toTrack = (t: RawTrack): Track | null =>
  t.id && t.title
    ? { id: String(t.id), title: t.title, artist: t.artist?.name ?? '', preview: t.preview || null }
    : null;

/** Walks a playlist's pages; Deezer caps a page at 100 regardless of how big the list is. */
async function playlistTracks(id: string): Promise<Track[]> {
  const out: Track[] = [];
  for (let index = 0; index < 2000; index += 100) {
    const body = await fetchJson(
      `https://api.deezer.com/playlist/${id}/tracks?index=${index}&limit=100`,
    );
    const data = (body?.data ?? []) as RawTrack[];
    if (data.length === 0) break;
    for (const t of data) {
      const track = toTrack(t);
      if (track) out.push(track);
    }
    if (data.length < 100) break;
  }
  return out;
}

async function albumTracks(albumId: string | number): Promise<Track[]> {
  const body = await fetchJson(`https://api.deezer.com/album/${albumId}`);
  const data = ((body?.tracks as { data?: RawTrack[] } | undefined)?.data ?? []) as RawTrack[];
  return data.flatMap((t) => toTrack(t) ?? []);
}

async function raw(category: Category): Promise<Track[]> {
  const all: Track[] = [];
  for (const id of category.playlistIds) all.push(...(await playlistTracks(id)));
  for (const title of category.titles ?? []) all.push(...(await albumTracks(title.albumId)));
  return all;
}

/** Does a preview url actually serve audio? Deezer's CDN refuses HEAD on some edges, so a 1-byte GET. */
async function audioAnswers(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { Range: 'bytes=0-0' },
      signal: AbortSignal.timeout(8000),
    });
    await res.body?.cancel();
    return res.ok;
  } catch {
    return false;
  }
}

export interface CategoryReport {
  id: string;
  label: string;
  group: string;
  raw: number;
  unique: number;
  playable: number;
  audioChecked: number;
  audioOk: number;
  sources: number;
  status: 'Pass' | 'Short';
}

async function main() {
  const args = process.argv.slice(2);
  const jsonAt = args.indexOf('--json');
  const jsonPath = jsonAt >= 0 ? args.splice(jsonAt, 2)[1] : null;
  const only = args[0];
  const targets = CATEGORIES.filter((c) => (only ? c.id === only : true));

  const reports: CategoryReport[] = [];
  for (const category of targets) {
    const all = await raw(category);

    // The same key the category pool builder uses: artist *and* title, because a category spans
    // many artists and two of them can legitimately share a song name.
    const kept = new Map<string, Track>();
    for (const t of all) {
      if (isUnwantedVersion(t.title)) continue;
      const key = `${normalizeTitle(t.artist)}|${normalizeTitle(stripAnyTrailingQualifier(t.title))}`;
      const existing = kept.get(key);
      if (!existing || (!existing.preview && t.preview)) kept.set(key, t);
    }
    const unique = [...kept.values()];
    const playable = unique.filter((t) => t.preview);
    const step = Math.max(1, Math.floor(playable.length / AUDIO_SAMPLE));
    const sample = playable.filter((_, i) => i % step === 0).slice(0, AUDIO_SAMPLE);
    const answers = await Promise.all(sample.map((t) => audioAnswers(t.preview!)));

    const report: CategoryReport = {
      id: category.id,
      label: category.label,
      group: category.group,
      raw: all.length,
      unique: unique.length,
      playable: playable.length,
      audioChecked: sample.length,
      audioOk: answers.filter(Boolean).length,
      sources: category.playlistIds.length + (category.titles?.length ?? 0),
      status: playable.length >= TARGET ? 'Pass' : 'Short',
    };
    reports.push(report);
    console.log(
      `${report.status.padEnd(5)} ${category.id.padEnd(34)} ${String(report.playable).padStart(5)} playable / ` +
        `${String(report.unique).padStart(5)} unique  audio ${report.audioOk}/${report.audioChecked}  (${report.sources} sources)`,
    );
    // A few real rows, because a healthy count built from the wrong music is still wrong.
    if (only) for (const t of playable.slice(0, 12)) console.log(`       ${t.artist} - ${t.title}`);
    if (jsonPath) writeFileSync(jsonPath, JSON.stringify(reports, null, 2));
  }

  const short = reports.filter((r) => r.status === 'Short');
  console.log(`\n${reports.length - short.length}/${reports.length} at ${TARGET}+ playable songs.`);
  if (short.length) console.log('Short: ' + short.map((r) => r.id).join(' '));
  process.exitCode = short.length ? 1 : 0;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
