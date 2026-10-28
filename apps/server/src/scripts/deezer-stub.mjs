/**
 * Load tests only: answers Deezer's public API from memory, so a test of a thousand players does not
 * send a thousand players' worth of lookups to Deezer from this machine. Preloaded with
 * `node --import` into the server under test; production never loads it.
 *
 * Every other request still goes out. The server's own Deezer throttle (45 calls per 5 s) still
 * applies to these, so how long a game takes to start is measured as it would be against Deezer.
 * On SIGTERM it prints how many Deezer calls the server made.
 */
const real = globalThis.fetch
let calls = 0
const json = (body) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })
const preview = (id) => `https://cdnt-preview.dzcdn.net/stub/${id}.mp3`

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname !== 'api.deezer.com') return real(input, init)
  calls++
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
  if (track) return json({ id: Number(track[1]), duration: 30, preview: preview(track[1]), artist: { name: 'Stub' } })
  const playlist = url.pathname.match(/^\/playlist\/(\d+)$/)
  if (playlist) return json({ id: Number(playlist[1]), title: `Playlist ${playlist[1]}`, picture_medium: null })
  return json({ data: [] })
}

process.on('SIGTERM', () => {
  process.stderr.write(`deezer-stub: ${calls} calls\n`)
  process.exit(0)
})
