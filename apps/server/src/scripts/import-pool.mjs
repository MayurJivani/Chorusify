// Put an exported song pool (npm run export:pool) back into an empty or partial database,
// e.g. after rebuilding the server. Preview URLs expire, so each track is re-read from Deezer.
//
//   node --env-file=/etc/apps/chorus.env apps/server/src/scripts/import-pool.mjs apps/server/pool.json
//
// Plain .mjs on purpose: it runs on the box against the built app, where tsx is pruned.
import { readFile } from 'node:fs/promises';
import postgres from 'postgres';

const file = process.argv[2];
if (!file || !process.env.DATABASE_URL) {
  console.error('usage: DATABASE_URL=... node import-pool.mjs <pool.json>');
  process.exit(1);
}
const { songs } = JSON.parse(await readFile(file, 'utf8'));
const sql = postgres(process.env.DATABASE_URL, { max: 1 });

let inserted = 0;
let skipped = 0;
for (const s of songs) {
  const res = await fetch(`https://api.deezer.com/track/${encodeURIComponent(s.deezerTrackId)}`, {
    headers: { Referer: 'https://chorusify.com/' },
  });
  const track = res.ok ? await res.json() : null;
  // Deezer answers 200 with { error } for a removed track; a song with no preview cannot be played.
  if (!track || track.error || !track.preview) {
    skipped++;
    console.warn(`skip ${s.artist} - ${s.title}: no playable preview`);
    continue;
  }
  await sql`
    insert into songs (title, artist, deezer_track_id, preview_url, album_art_url, duration_seconds, active, manual_override)
    values (${s.title}, ${s.artist}, ${s.deezerTrackId}, ${track.preview},
            ${s.albumArtUrl ?? track.album?.cover_medium ?? null}, ${s.durationSeconds ?? track.duration},
            true, ${Boolean(s.pinned)})
    on conflict (deezer_track_id) do update
      set preview_url = excluded.preview_url, active = true,
          manual_override = songs.manual_override or excluded.manual_override, verified_at = now()`;
  inserted++;
  await new Promise((r) => setTimeout(r, 120)); // Deezer allows ~50 requests per 5 s
}

const [{ total, pinned }] = await sql`
  select count(*)::int as total, count(*) filter (where manual_override)::int as pinned from songs`;
await sql.end();
console.log(`imported ${inserted}, skipped ${skipped}; table now has ${total} songs, ${pinned} pinned`);
// Self-check: every pinned song in the file should be pinned in the table unless Deezer dropped it.
if (pinned < songs.filter((s) => s.pinned).length - skipped) process.exit(2);
