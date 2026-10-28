/**
 * Many small rooms at once: the shape a thousand players actually take, since a room holds eight by
 * default (loadtest-room.ts is the other shape, one host and an audience).
 *
 *   DATABASE_URL=postgres://... npx tsx apps/server/src/scripts/loadtest-rooms.ts [rooms=125] [players=8]
 *
 * Runs the built server (npm run build first) on a spare port against DATABASE_URL, which it migrates,
 * so never point it at production. Deezer is answered from memory by deezer-stub.mjs, preloaded into
 * the server only; the server's own Deezer throttle still applies, so game starts queue exactly as
 * they would against Deezer.
 *
 * The server boots twice. The first boot plays one short game per category so their song pools are
 * stored; the second starts with an empty preview cache, as after a restart, and is what is measured.
 * Every room's host starts at once, then each player answers every round after a few seconds.
 *
 * Reports how long each room waited from start_game to round_start (this is where the Deezer budget
 * shows), the guess round trip, the server's CPU and RSS, and Deezer calls. Fails if a game does not
 * reach game_over or a socket drops.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';

const ROOMS = Number(process.argv[2] ?? 125);
const PER_ROOM = Number(process.argv[3] ?? 8);
const CATEGORIES = ['now-worldwide', 'year-2025', 'decade-2010s', 'decade-2000s', 'decade-90s'];
const PORT = 4800 + Math.floor(Math.random() * 300);
const ORIGIN = `http://127.0.0.1:${PORT}`;
const SERVER = path.join(__dirname, '..', '..');
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) =>
  xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]! : NaN;
const fmt = (xs: number[]) =>
  `p50 ${pct(xs, 0.5).toFixed(0)}ms, p95 ${pct(xs, 0.95).toFixed(0)}ms, max ${pct(xs, 1).toFixed(0)}ms`;

const env = {
  ...process.env,
  NODE_ENV: 'development',
  PORT: String(PORT),
  LOG_LEVEL: 'warn',
  SESSION_SECRET: 'l'.repeat(48),
  CSRF_SECRET: 'c'.repeat(48),
  CORS_ORIGIN: ORIGIN,
};

async function boot(): Promise<{ server: ChildProcess; deezerCalls: () => Promise<number> }> {
  const migrate = spawn(process.execPath, ['dist/db/migrate.js'], {
    cwd: SERVER,
    env,
    stdio: 'ignore',
  });
  await new Promise((r) => migrate.on('exit', r));
  const server = spawn(
    process.execPath,
    ['--import', path.join(__dirname, 'deezer-stub.mjs'), 'dist/index.js'],
    { cwd: SERVER, env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let err = '';
  server.stderr!.on('data', (d) => (err += d));
  for (
    let i = 0;
    !(await fetch(`${ORIGIN}/api/categories`).then(
      (r) => r.ok,
      () => false,
    ));
    i++
  ) {
    if (i > 200) throw new Error(`server did not come up:\n${err}`);
    await sleep(100);
  }
  const deezerCalls = () =>
    new Promise<number>((resolve) => {
      server.on('exit', () => resolve(Number(/deezer-stub: (\d+)/.exec(err)?.[1] ?? NaN)));
      server.kill('SIGTERM');
    });
  return { server, deezerCalls };
}

/** A guest session: the cookie header and the CSRF value writes must echo. */
async function session(): Promise<{ cookie: string; csrf: string }> {
  const res = await fetch(`${ORIGIN}/api/categories`);
  const raw = (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]!);
  const sid = raw.find((c) => c.startsWith('chorusify_sid='));
  const csrfCookie = raw.find((c) => c.includes('csrf'));
  if (!sid || !csrfCookie) throw new Error('No session cookies from the server');
  return { cookie: [sid, csrfCookie].join('; '), csrf: csrfCookie.split('=').slice(1).join('=') };
}

async function createRoom(categoryId: string, rounds: number): Promise<string> {
  const s = await session();
  const res = await fetch(`${ORIGIN}/api/multiplayer/rooms`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: s.cookie,
      'x-csrf-token': s.csrf,
      Origin: ORIGIN,
    },
    body: JSON.stringify({ categoryId, guessMode: 'choice', rounds }),
  });
  if (!res.ok) throw new Error(`Room create failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { code: string }).code;
}

interface Player {
  ws: WebSocket;
  selfId: string | null;
  hostId: string | null;
  done: Promise<boolean>;
}

const startMs: number[] = [];
const guessMs: number[] = [];
let drops = 0;

/** Joins a room and plays it: answers each round after a few seconds, resolves true at game_over. */
async function join(code: string, n: number, answer = true): Promise<Player> {
  const { cookie } = await session();
  const ws = new WebSocket(`${ORIGIN.replace('http', 'ws')}/ws`, {
    headers: { Cookie: cookie, Origin: ORIGIN },
  });
  await new Promise<void>(
    (resolve, reject) => (ws.once('open', () => resolve()), ws.once('error', reject)),
  );
  const p: Player = { ws, selfId: null, hostId: null, done: Promise.resolve(false) };
  let guessedAt = 0;
  let finished = false;
  p.done = new Promise<boolean>((resolve) => {
    ws.on('close', () => (finished ? undefined : (drops++, resolve(false))));
    ws.on('message', (data) => {
      const m = JSON.parse(data.toString()) as {
        type: string;
        selfId?: string;
        room?: { hostId?: string };
        options?: { deezerTrackId: string }[];
        roundIndex?: number;
      };
      if (m.selfId) p.selfId = m.selfId;
      if (m.room?.hostId) p.hostId = m.room.hostId;
      if (m.type === 'round_start' && answer && m.options?.length) {
        const pick = m.options[Math.floor(Math.random() * m.options.length)]!.deezerTrackId;
        setTimeout(
          () => {
            guessedAt = performance.now();
            ws.send(JSON.stringify({ type: 'guess', trackId: pick }));
          },
          1000 + Math.random() * 5000,
        );
      }
      if (m.type === 'guess_result' && guessedAt) {
        guessMs.push(performance.now() - guessedAt);
        guessedAt = 0;
      }
      if (m.type === 'game_over') {
        finished = true;
        resolve(true);
      }
    });
  });
  // Seated once the room says so: join_room awaits a lookup, and a start_game sent before it lands is ignored.
  const seated = new Promise<void>((resolve) => ws.once('message', () => resolve()));
  ws.send(JSON.stringify({ type: 'join_room', code, nickname: `L${n}` }));
  await seated;
  return p;
}

/** One room: the creator joins first and so hosts, the rest join, the host starts on cue. */
async function room(
  r: number,
  players: number,
  go: Promise<void>,
  rounds: number,
): Promise<boolean> {
  const code = await createRoom(CATEGORIES[r % CATEGORIES.length]!, rounds);
  const host = await join(code, r * 100);
  const rest: Player[] = [];
  for (let i = 1; i < players; i++) rest.push(await join(code, r * 100 + i));
  await go;
  const t0 = performance.now();
  host.ws.once('message', function first(data) {
    if (!data.toString().includes('"round_start"')) return void host.ws.once('message', first);
    startMs.push(performance.now() - t0);
  });
  host.ws.send(JSON.stringify({ type: 'start_game' }));
  const ok = (await Promise.all([host, ...rest].map((p) => p.done))).every(Boolean);
  for (const p of [host, ...rest]) p.ws.close();
  return ok;
}

/** Server CPU (ms) and RSS (MB) from /proc, so the clients in this process do not count. */
const usage = (pid: number) => {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
  const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))![1]) / 1024;
  return { cpu: (Number(stat[11]) + Number(stat[12])) * 10, rss };
};

async function main() {
  // First boot: one game per category so every pool is stored, as on a box that has been running.
  const warm = await boot();
  let open!: () => void;
  const now = new Promise<void>((r) => (open = r));
  const warming = CATEGORIES.map((_, i) => room(i, 1, now, 3));
  open();
  await Promise.all(warming);
  startMs.length = 0;
  guessMs.length = 0;
  await warm.deezerCalls();

  // Second boot: pools in the database, preview cache empty.
  const { server, deezerCalls } = await boot();
  const pid = server.pid!;
  let peak = 0;
  const sampler = setInterval(() => (peak = Math.max(peak, usage(pid).rss)), 250);
  let go!: () => void;
  const cue = new Promise<void>((r) => (go = r));
  const t0 = performance.now();
  const games = Array.from({ length: ROOMS }, (_, r) => room(r, PER_ROOM, cue, 3));
  // Let every room fill, then every host presses start in the same moment.
  await sleep(Math.max(3000, ROOMS * PER_ROOM * 3));
  const cpu0 = usage(pid).cpu;
  const startedAt = performance.now();
  go();
  const results = await Promise.all(games);
  const wall = performance.now() - startedAt;
  const cpu = usage(pid).cpu - cpu0;
  clearInterval(sampler);
  const calls = await deezerCalls();

  const finished = results.filter(Boolean).length;
  console.log(
    `${ROOMS} rooms x ${PER_ROOM} = ${ROOMS * PER_ROOM} players, filled in ${((startedAt - t0) / 1000).toFixed(1)}s`,
  );
  console.log(`start_game to round_start, all hosts at once: ${fmt(startMs)}`);
  console.log(`guess round trip: ${fmt(guessMs)} (${guessMs.length} guesses)`);
  console.log(`${finished}/${ROOMS} games reached game_over; ${drops} dropped sockets`);
  console.log(
    `server: ${(cpu / 1000).toFixed(1)}s CPU over ${(wall / 1000).toFixed(1)}s (${((cpu / wall) * 100).toFixed(0)}% of one core), peak RSS ${peak.toFixed(0)} MB; ${calls} Deezer calls (stubbed)`,
  );
  const failed = ROOMS - finished + drops;
  console.log(failed ? 'FAIL' : 'ok');
  process.exit(failed ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
