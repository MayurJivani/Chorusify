/**
 * Load tests only: answers Deezer's public API from memory, so a test of a thousand players does not
 * send a thousand players' worth of lookups to Deezer from this machine. Preloaded with
 * `node --import` into the server under test; production never loads it.
 *
 * Every other request still goes out. The server's own Deezer throttle still applies to these, so
 * how long a game takes to start is measured as it would be against Deezer.
 *
 * Writes its call count to DEEZER_STUB_FILE and prints it on SIGTERM. DEEZER_STUB_LATENCY_MS adds
 * realistic delay. While the file named by DEEZER_STUB_FAIL_FILE exists, every call fails, which is
 * how the outage scenario switches Deezer off and back on.
 */
import { existsSync, writeFileSync } from 'node:fs'

const real = globalThis.fetch
const latency = Number(process.env.DEEZER_STUB_LATENCY_MS ?? 0)
let calls = 0
const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const preview = (id) => `https://cdnt-preview.dzcdn.net/stub/${id}.mp3`
const searchTrack = (id, q) => ({
  id,
  title: `${q} song ${id}`,
  duration: 30,
  preview: preview(id),
  artist: { name: `${q} artist` },
  album: { title: `${q} album`, cover_medium: null },
})

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname !== 'api.deezer.com') return real(input, init)
  calls++
  if (process.env.DEEZER_STUB_FILE) writeFileSync(process.env.DEEZER_STUB_FILE, String(calls))
  if (latency) await new Promise((r) => setTimeout(r, latency))
  if (process.env.DEEZER_STUB_FAIL_FILE && existsSync(process.env.DEEZER_STUB_FAIL_FILE)) {
    throw new TypeError('fetch failed (stubbed outage)')
  }
  if (url.pathname === '/search') {
    const q = url.searchParams.get('q') ?? ''
    return json({ data: Array.from({ length: 25 }, (_, i) => searchTrack(5000000 + i * 7 + q.length * 1000, q.slice(0, 20))) })
  }
  const tracks = url.pathname.match(/^\/playlist\/(\d+)\/tracks$/)
  if (tracks) {
    // 150 distinct tracks per playlist, so a category pool is big enough to play.
    return json({
      data: Array.from({ length: 150 }, (_, i) => {
        const id = Number(`${tracks[1].slice(-5)}${String(i).padStart(3, '0')}`)
        return { id, title: `Song ${i} of ${tracks[1]}`, duration: 30, preview: preview(id), artist: { name: `Artist ${i % 40}` }, album: { cover_medium: null } }
      }),
    })
  }
  const track = url.pathname.match(/^\/track\/(\d+)$/)
  if (track) {
    // Ids ending 13 stand in for songs that have lost their preview.
    if (track[1].endsWith('13')) return json({ id: Number(track[1]), duration: 30, preview: '' })
    return json({ id: Number(track[1]), duration: 30, preview: preview(track[1]), artist: { name: 'Stub' } })
  }
  const playlist = url.pathname.match(/^\/playlist\/(\d+)$/)
  if (playlist) return json({ id: Number(playlist[1]), title: `Playlist ${playlist[1]}`, picture_medium: null })
  return json({ data: [] })
}

process.on('SIGTERM', () => {
  process.stderr.write(`deezer-stub: ${calls} calls\n`)
  process.exit(0)
})
