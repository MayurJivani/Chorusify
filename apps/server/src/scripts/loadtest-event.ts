/**
 * The event load test: real WebSocket clients against the built server, one room, up to a thousand.
 *
 *   npm run build -w apps/server
 *   LOADTEST_DATABASE_URL=postgres://...local... npx tsx apps/server/src/scripts/loadtest-event.ts \
 *     [--players 1000] [--scenarios A,B,C,D,E,F] [--soak-minutes 20] [--json out.json] [--no-limits]
 *
 * It boots the server itself on a spare port with Deezer stubbed (deezer-stub.mjs), and refuses any
 * database that is not on localhost, because it writes to it. Clients run in worker processes so
 * that the harness's own event loop does not show up as server latency, and everything shares one
 * machine's clock, so server-to-client delivery can be read directly from the server's timestamps.
 * That also means none of this measures the network: these are capacity numbers for one server
 * process, not a claim about a real venue's wifi.
 *
 *   A  1,000-player lobby          B  full game, all answering at once
 *   C  host-only audio             D  everyone-plays: sync, reconnects, late joins, dead previews
 *   E  Deezer: coalescing, cache, outage (run with --no-limits)
 *   F  sustained connections, memory and lag over time
 */
import { fork, spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { WebSocket } from 'ws';

const WORKERS = 4;
const SERVER_DIR = path.join(__dirname, '..', '..');

interface Summary {
  n: number;
  p50: number;
  p95: number;
  p99: number;
  max: number;
}
const summarize = (xs: number[]): Summary => {
  const s = xs.slice().sort((a, b) => a - b);
  const at = (p: number) => Math.round((s[Math.floor((s.length - 1) * p)] ?? 0) * 10) / 10;
  return { n: s.length, p50: at(0.5), p95: at(0.95), p99: at(0.99), max: at(1) };
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// --- Worker: holds a share of the sockets and does what the coordinator says ------------------

type Cmd =
  | { cmd: 'connect'; origin: string; code: string; from: number; count: number; password?: string }
  | { cmd: 'guess'; pick: 'first'; spreadMs: number }
  | { cmd: 'reset' }
  | { cmd: 'report' }
  | { cmd: 'drop'; count: number }
  | { cmd: 'rejoin' }
  | { cmd: 'close' };

interface WorkerClient {
  ws: WebSocket;
  guest: { cookie: string };
  nick: string;
  options: string[];
  guessedAt: number;
  roundStart?: { roundIndex: number; previewUrl: string | null; startedAt: number };
  gameOver: boolean;
}

async function worker() {
  const clients: WorkerClient[] = [];
  const dropped: WorkerClient[] = [];
  let origin = '';
  let code = '';
  let password: string | undefined;
  const lat: Record<string, number[]> = {
    guessRtt: [],
    joinRtt: [],
    roundStartDelivery: [],
    scoresGapMs: [],
  };
  const tally: Record<string, number> = {};
  const startInstants = new Set<number>();
  const previews = new Set<string>();
  const bump = (k: string) => (tally[k] = (tally[k] ?? 0) + 1);
  const previewsSeen: Record<string, number> = { withAudio: 0, withoutAudio: 0 };
  let audioFrames = 0;

  const open = (c: WorkerClient): Promise<void> =>
    new Promise((resolve, reject) => {
      const t0 = performance.now();
      const ws = new WebSocket(`${origin.replace('http', 'ws')}/ws`, {
        headers: { Cookie: c.guest.cookie, Origin: origin },
      });
      c.ws = ws;
      ws.once('error', (e) => (bump('connectError'), reject(e)));
      ws.on('close', (closeCode) => bump(`close${closeCode}`));
      ws.once('open', () => {
        ws.send(JSON.stringify({ type: 'join_room', code, nickname: c.nick, password }));
      });
      let joined = false;
      ws.on('message', (data, isBinary) => {
        // A browser cannot read binary frames, even though this client could.
        if (isBinary) bump('error:binaryFrame');
        const text = data.toString();
        const now = Date.now();
        bump('framesIn');
        tally.bytesIn = (tally.bytesIn ?? 0) + text.length;
        if (text.includes('"host_round"') || text.includes('"reveal_audio"')) audioFrames += 1;
        const m = JSON.parse(text) as Record<string, any>;
        if (!joined && m.type === 'room_state') {
          joined = true;
          lat.joinRtt!.push(performance.now() - t0);
          resolve();
        }
        switch (m.type) {
          case 'error':
            bump(`error:${m.code ?? String(m.message).slice(0, 30)}`);
            if (!joined) {
              joined = true;
              resolve();
            }
            break;
          case 'round_start':
            bump('roundStarts');
            c.roundStart = m as WorkerClient['roundStart'];
            c.options = (m.options as { deezerTrackId: string }[]).map((o) => o.deezerTrackId);
            // From the moment the server began the round (music is scheduled 2.5s after), so
            // this is the whole fan-out: the last client's number includes everyone before it.
            if (c.roundStart && now < m.startedAt)
              lat.roundStartDelivery!.push(now - (m.startedAt - 2500));
            startInstants.add(m.startedAt);
            if (m.previewUrl) {
              previewsSeen.withAudio! += 1;
              previews.add(m.previewUrl);
            } else previewsSeen.withoutAudio! += 1;
            break;
          case 'guess_result':
            bump('guessResults');
            if (c.guessedAt) lat.guessRtt!.push(performance.now() - c.guessedAt);
            c.guessedAt = 0;
            break;
          case 'round_end':
            bump('roundEnds');
            if (m.correct?.previewUrl) previewsSeen.withAudio! += 1;
            break;
          case 'game_over':
            bump('gameOvers');
            c.gameOver = true;
            break;
          default:
            break;
        }
      });
    });

  process.on('message', async (raw) => {
    const msg = raw as Cmd;
    switch (msg.cmd) {
      case 'connect': {
        origin = msg.origin;
        code = msg.code;
        password = msg.password;
        const ids = Array.from({ length: msg.count }, (_, i) => msg.from + i);
        // Paced: a stampede of phones arrives over seconds, not in one tick.
        for (let i = 0; i < ids.length; i += 25) {
          await Promise.all(
            ids.slice(i, i + 25).map(async (id) => {
              const res = await fetch(`${origin}/api/categories`);
              const cookie = (res.headers.getSetCookie?.() ?? [])
                .map((x) => x.split(';')[0]!)
                .filter((x) => x.startsWith('chorusify_sid='))
                .join('; ');
              await res.arrayBuffer();
              const c: WorkerClient = {
                ws: null as unknown as WebSocket,
                guest: { cookie },
                nick: `P${id}`,
                options: [],
                guessedAt: 0,
                gameOver: false,
              };
              clients.push(c);
              await open(c).catch(() => undefined);
            }),
          );
        }
        process.send!({ done: 'connect', connected: clients.length });
        break;
      }
      case 'guess': {
        let sent = 0;
        for (const c of clients) {
          if (!c.options.length || c.ws.readyState !== WebSocket.OPEN) continue;
          const pick = c.options[Math.floor(Math.random() * c.options.length)]!;
          sent += 1;
          setTimeout(() => {
            c.guessedAt = performance.now();
            if (c.ws.readyState === WebSocket.OPEN) {
              c.ws.send(JSON.stringify({ type: 'guess', trackId: pick }));
            }
          }, Math.random() * msg.spreadMs);
        }
        process.send!({ done: 'guess', sent });
        break;
      }
      case 'drop': {
        for (const c of clients.splice(0, msg.count)) {
          c.ws.terminate();
          dropped.push(c);
        }
        process.send!({ done: 'drop' });
        break;
      }
      case 'rejoin': {
        const back = dropped.splice(0);
        await Promise.all(back.map((c) => open(c).catch(() => undefined)));
        clients.push(...back);
        process.send!({ done: 'rejoin', rejoined: back.length });
        break;
      }
      case 'reset': {
        for (const k of Object.keys(lat)) lat[k] = [];
        for (const k of Object.keys(tally)) delete tally[k];
        startInstants.clear();
        previews.clear();
        previewsSeen.withAudio = 0;
        previewsSeen.withoutAudio = 0;
        audioFrames = 0;
        process.send!({ done: 'reset' });
        break;
      }
      case 'report':
        process.send!({
          done: 'report',
          lat,
          tally,
          startInstants: [...startInstants],
          previews: [...previews],
          previewsSeen,
          audioFrames,
          open: clients.filter((c) => c.ws.readyState === WebSocket.OPEN).length,
        });
        break;
      case 'close':
        for (const c of clients) c.ws.close();
        setTimeout(() => process.exit(0), 200);
        break;
      default:
        break;
    }
  });
  process.send!({ done: 'ready' });
}

// --- Coordinator ------------------------------------------------------------------------------

class Workers {
  private procs: ChildProcess[] = [];
  async start() {
    this.procs = Array.from({ length: WORKERS }, () =>
      fork(__filename, ['--worker'], { execArgv: process.execArgv }),
    );
    await Promise.all(this.procs.map((p) => this.wait(p, 'ready')));
  }
  private wait(p: ChildProcess, done: string): Promise<any> {
    return new Promise((resolve) => {
      const on = (m: any) => {
        if (m.done === done) {
          p.off('message', on);
          resolve(m);
        }
      };
      p.on('message', on);
    });
  }
  all(cmd: Cmd & { cmd: string }, done = cmd.cmd): Promise<any[]> {
    return Promise.all(
      this.procs.map((p) => {
        const w = this.wait(p, done);
        p.send(cmd);
        return w;
      }),
    );
  }
  async connect(origin: string, code: string, players: number, password?: string) {
    const each = Math.ceil(players / WORKERS);
    await Promise.all(
      this.procs.map((p, i) => {
        const w = this.wait(p, 'connect');
        p.send({
          cmd: 'connect',
          origin,
          code,
          from: i * each,
          count: Math.min(each, players - i * each),
          password,
        });
        return w;
      }),
    );
  }
  async report() {
    const rs = await this.all({ cmd: 'report' });
    const merge = (k: string) => rs.flatMap((r) => r.lat[k] as number[]);
    const tally: Record<string, number> = {};
    for (const r of rs) {
      for (const [k, v] of Object.entries(r.tally)) tally[k] = (tally[k] ?? 0) + (v as number);
    }
    return {
      guessRtt: summarize(merge('guessRtt')),
      joinRtt: summarize(merge('joinRtt')),
      roundStartDelivery: summarize(merge('roundStartDelivery')),
      tally,
      startInstants: [...new Set(rs.flatMap((r) => r.startInstants as number[]))],
      previews: [...new Set(rs.flatMap((r) => r.previews as string[]))],
      withAudio: rs.reduce((a, r) => a + r.previewsSeen.withAudio, 0),
      withoutAudio: rs.reduce((a, r) => a + r.previewsSeen.withoutAudio, 0),
      audioFrames: rs.reduce((a, r) => a + r.audioFrames, 0),
      open: rs.reduce((a, r) => a + r.open, 0),
    };
  }
  stop() {
    for (const p of this.procs) p.send({ cmd: 'close' });
  }
}

function usage(pid: number) {
  const stat = readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1]!.split(' ');
  const rss = Number(/VmRSS:\s+(\d+)/.exec(readFileSync(`/proc/${pid}/status`, 'utf8'))![1]) / 1024;
  return { cpuMs: (Number(stat[11]) + Number(stat[12])) * 10, rssMb: Math.round(rss) };
}

const ADMIN = { email: 'loadtest-host@example.test', password: 'load-test-Pass-9417!' };

class Api {
  cookies = new Map<string, string>();
  csrf = '';
  constructor(readonly origin: string) {}
  private header() {
    return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; ');
  }
  async call(method: string, url: string, body?: unknown): Promise<any> {
    const res = await fetch(`${this.origin}${url}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        Cookie: this.header(),
        'x-csrf-token': this.csrf,
        Origin: this.origin,
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    for (const c of res.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(';');
      const eq = pair!.indexOf('=');
      this.cookies.set(pair!.slice(0, eq), pair!.slice(eq + 1));
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`${method} ${url}: ${res.status} ${JSON.stringify(data)}`);
    return data;
  }
  async login() {
    this.csrf = (await this.call('GET', '/api/csrf-token')).csrfToken;
    const auth = await this.call('POST', '/api/auth/register', {
      email: ADMIN.email,
      password: ADMIN.password,
      displayName: 'Load Host',
    }).catch(() =>
      this.call('POST', '/api/auth/login', { email: ADMIN.email, password: ADMIN.password }),
    );
    this.csrf = auth.csrfToken;
  }
}

/** The host's own socket. Holds no seat in the room unless the event says so. */
class HostSocket {
  ws!: WebSocket;
  frames: Record<string, any>[] = [];
  phaseWait: ((m: any) => void)[] = [];
  connect(api: Api, eventId: string, code: string) {
    return new Promise<void>((resolve, reject) => {
      this.ws = new WebSocket(`${api.origin.replace('http', 'ws')}/ws`, {
        headers: {
          Cookie: [...api.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
          Origin: api.origin,
        },
      });
      this.ws.once('error', reject);
      this.ws.once('open', () => {
        this.ws.send(JSON.stringify({ type: 'host_event', eventId, code }));
      });
      let up = false;
      this.ws.on('message', (data) => {
        const m = JSON.parse(data.toString()) as Record<string, any>;
        this.frames.push({
          type: m.type,
          code: m.code,
          previewUrl: m.previewUrl,
          playerCount: m.room?.playerCount,
          phase: m.room?.phase,
          title: m.title,
        });
        if (this.frames.length > 2000) this.frames.splice(0, 1000);
        if (!up && m.type === 'room_state') {
          up = true;
          resolve();
        }
        this.waiters = this.waiters.filter((w) => {
          if (w.type !== m.type) return true;
          w.resolve(m);
          return false;
        });
      });
    });
  }
  waiters: { type: string; resolve: (m: any) => void }[] = [];
  next(type: string, timeoutMs = 90_000): Promise<any> {
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error(`timed out waiting for ${type}`)), timeoutMs);
      this.waiters.push({
        type,
        resolve: (m) => {
          clearTimeout(t);
          resolve(m);
        },
      });
    });
  }
  send(m: Record<string, unknown>) {
    this.ws.send(JSON.stringify(m));
  }
  close() {
    this.ws.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string, fallback: string) => {
    const at = args.indexOf(`--${name}`);
    return at >= 0 ? args[at + 1]! : fallback;
  };
  const PLAYERS = Number(flag('players', '1000'));
  const SCENARIOS = flag('scenarios', 'A,B,C,D,E,F').split(',');
  const SOAK_MINUTES = Number(flag('soak-minutes', '20'));
  const JSON_OUT = flag('json', '');

  const dbUrl = process.env.LOADTEST_DATABASE_URL;
  if (!dbUrl) throw new Error('LOADTEST_DATABASE_URL is required');
  const dbHost = new URL(dbUrl).hostname;
  // The local .env points at production through a tunnel on 127.0.0.1, so localhost alone is not
  // enough: only a database explicitly named for this can be written to.
  if (
    !['127.0.0.1', 'localhost'].includes(dbHost) ||
    !/local|loadtest/.test(new URL(dbUrl).pathname)
  ) {
    throw new Error(
      'Refusing: the load test writes to its database. Use a local one named *local* or *loadtest*.',
    );
  }

  const tmp = mkdtempSync(path.join(tmpdir(), 'chorus-loadtest-'));
  const stubCount = path.join(tmp, 'calls');
  const failFile = path.join(tmp, 'deezer-down');
  const port = 4800 + Math.floor(Math.random() * 300);
  const origin = `http://127.0.0.1:${port}`;
  const env = {
    ...process.env,
    DATABASE_URL: dbUrl,
    // Only for the per-account search limit (90 a minute), which scenario E exists to go past so
    // that the layer behind it is what gets measured. That limit itself is covered by the test suite.
    NODE_ENV: args.includes('--no-limits') ? 'test' : 'development',
    PORT: String(port),
    LOG_LEVEL: 'warn',
    SESSION_SECRET: 'l'.repeat(48),
    CSRF_SECRET: 'c'.repeat(48),
    CORS_ORIGIN: origin,
    ADMIN_EMAIL: ADMIN.email,
    ADMIN_REGISTRATION_OPEN: 'true',
    DEEZER_STUB_FILE: stubCount,
    DEEZER_STUB_FAIL_FILE: failFile,
    DEEZER_STUB_LATENCY_MS: '120',
  };
  await new Promise((r) =>
    spawn(process.execPath, ['dist/db/migrate.js'], { cwd: SERVER_DIR, env, stdio: 'ignore' }).on(
      'exit',
      r,
    ),
  );
  const server = spawn(
    process.execPath,
    ['--import', path.join(__dirname, 'deezer-stub.mjs'), 'dist/index.js'],
    { cwd: SERVER_DIR, env, stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let serverErr = '';
  server.stderr!.on('data', (d) => (serverErr = (serverErr + d).slice(-4000)));
  for (let i = 0; ; i++) {
    const up = await fetch(`${origin}/api/health`).then(
      (r) => r.ok,
      () => false,
    );
    if (up) break;
    if (i > 200) throw new Error(`server did not come up:\n${serverErr}`);
    await sleep(100);
  }
  const pid = server.pid!;
  const stubCalls = () => (existsSync(stubCount) ? Number(readFileSync(stubCount, 'utf8')) : 0);

  const api = new Api(origin);
  await api.login();
  const metrics = () => api.call('GET', '/api/admin/metrics');
  const report: Record<string, unknown> = {
    players: PLAYERS,
    workers: WORKERS,
    startedAt: new Date().toISOString(),
  };

  /** The stub's ids ending 13 lose their preview, so one playlist position can be a dead song. */
  const playlistOf = (n: number, withDeadSong = false) =>
    Array.from({ length: n }, (_, i) => ({
      deezerTrackId: withDeadSong && i === 1 ? '7700013' : String(7700100 + i),
      title: `Load song ${i}`,
      artist: `Load artist ${i % 7}`,
      album: null,
      albumArtUrl: null,
      durationSeconds: 30,
    }));

  const makeEvent = async (
    name: string,
    audioMode: string,
    rounds: number,
    withDeadSong = false,
  ) => {
    const { playlist } = await api.call('POST', '/api/events/playlists', {
      name,
      tracks: playlistOf(Math.max(rounds, 4), withDeadSong),
    });
    const { event } = await api.call('POST', '/api/events', {
      name,
      description: '',
      visibility: 'unlisted',
      audioMode,
      hostPlays: false,
      rounds,
      playbackSeconds: 5,
      guessSeconds: 12,
      maxPoints: 1000,
      minPoints: 100,
      firstBonus: 50,
      playlistId: playlist.id,
    });
    return event as { id: string; code: string };
  };
  const hostFor = async (event: { id: string; code: string }) => {
    const h = new HostSocket();
    await h.connect(api, event.id, event.code);
    return h;
  };

  const runRoom = async (name: string, audioMode: string, rounds: number) => {
    const event = await makeEvent(name, audioMode, rounds);
    const host = await hostFor(event);
    const workers = new Workers();
    await workers.start();
    return { event, host, workers };
  };

  const scenarioGame = async (name: string, audioMode: string, rounds: number) => {
    const { event, host, workers } = await runRoom(name, audioMode, rounds);
    const t0 = performance.now();
    await workers.connect(origin, event.code, PLAYERS);
    const fillSeconds = (performance.now() - t0) / 1000;
    await sleep(1000);
    const cpu0 = usage(pid);
    const started = performance.now();
    host.send({ type: 'start_game' });
    const guessRounds: number[] = [];
    for (let r = 0; r < rounds; r += 1) {
      const hr = await host.next('host_round');
      await sleep(Math.max(0, hr.playAt - Date.now()) + 200);
      const roundT = performance.now();
      // Everyone within two seconds: the worst realistic burst, a room of people answering at once.
      await workers.all({ cmd: 'guess', pick: 'first', spreadMs: 2000 });
      await host.next('round_end');
      guessRounds.push(performance.now() - roundT);
      if (r < rounds - 1) host.send({ type: 'host_skip' });
    }
    if (rounds > 0) host.send({ type: 'host_skip' });
    await host.next('game_over');
    await sleep(1000);
    const wallMs = performance.now() - started;
    const cpu1 = usage(pid);
    const r = await workers.report();
    const m = await metrics();
    const hostAudio = host.frames.filter((f) => f.type === 'host_round' && f.previewUrl).length;
    const hostSeated = host.frames.filter((f) => f.type === 'round_start').length;
    host.close();
    workers.stop();
    await sleep(500);
    return {
      event,
      fillSeconds,
      wallMs,
      cpuPct: Math.round(((cpu1.cpuMs - cpu0.cpuMs) / wallMs) * 100),
      rssMb: cpu1.rssMb,
      r,
      m,
      hostAudio,
      hostSeated,
      guessRounds,
    };
  };

  try {
    if (SCENARIOS.includes('A')) {
      console.log(`A: ${PLAYERS}-player lobby`);
      const { event, host, workers } = await runRoom('Scenario A', 'everyone_plays', 3);
      const t0 = performance.now();
      await workers.connect(origin, event.code, PLAYERS);
      const fillSeconds = (performance.now() - t0) / 1000;
      await sleep(1500);
      const r = await workers.report();
      const hostView = host.frames.filter((f) => f.type === 'room_state').at(-1);
      const m = await metrics();
      report.A = {
        fillSeconds,
        connected: r.open,
        connectFailures: PLAYERS - r.open,
        joinRtt: r.joinRtt,
        hostSeesPlayers: hostView?.playerCount,
        lobbyFramesPerClient: Math.round((r.tally.framesIn ?? 0) / r.open),
        lobbyMbReceivedTotal: Math.round((r.tally.bytesIn ?? 0) / 1048576),
        serverRssMb: usage(pid).rssMb,
        eventLoopLagMs: m.eventLoopLagMs,
      };
      console.log(report.A);
      host.close();
      workers.stop();
      await sleep(2000);
    }

    if (SCENARIOS.includes('B')) {
      console.log(`B: full game, ${PLAYERS} players`);
      const g = await scenarioGame('Scenario B', 'everyone_plays', 4);
      report.B = {
        fillSeconds: g.fillSeconds,
        players: g.r.open,
        guessesSent: g.r.guessRtt.n,
        guessResults: g.r.tally.guessResults,
        errors: Object.fromEntries(
          Object.entries(g.r.tally).filter(([k]) => k.startsWith('error') || k.startsWith('close')),
        ),
        guessRttClient: g.r.guessRtt,
        answerProcessingServer: g.m.answerProcessingMs,
        roundStartDelivery: g.r.roundStartDelivery,
        distinctStartInstantsPerRound: g.r.startInstants.length,
        gameOversReceived: g.r.tally.gameOvers,
        cpuPctOfOneCore: g.cpuPct,
        rssMb: g.rssMb,
        eventLoopLagMs: g.m.eventLoopLagMs,
        framesOutPerClient: Math.round((g.r.tally.framesIn ?? 0) / g.r.open),
      };
      console.log(report.B);
    }

    if (SCENARIOS.includes('C')) {
      console.log('C: host-only audio');
      const g = await scenarioGame('Scenario C', 'host_only', 3);
      report.C = {
        players: g.r.open,
        playerFramesWithAudioUrl: g.r.withAudio,
        playerRoundStartsWithoutAudio: g.r.withoutAudio,
        playerFramesWithHostCommands: g.r.audioFrames,
        hostRoundsWithAudio: g.hostAudio,
        hostSeatedAsPlayer: g.hostSeated > 0,
        gameOversReceived: g.r.tally.gameOvers,
      };
      console.log(report.C);
    }

    if (SCENARIOS.includes('D')) {
      console.log('D: everyone-plays: sync, reconnect, late join, dead preview');
      const event = await makeEvent('Scenario D', 'everyone_plays', 4, true);
      const host = await hostFor(event);
      const workers = new Workers();
      await workers.start();
      const initial = Math.floor(PLAYERS * 0.9);
      await workers.connect(origin, event.code, initial);
      await sleep(1000);
      host.send({ type: 'start_game' });
      const hr1 = await host.next('host_round');
      await sleep(Math.max(0, hr1.playAt - Date.now()) + 300);
      const skippedDead = host.frames.find((f) => f.type === 'song_skipped');

      await workers.all({ cmd: 'guess', pick: 'first', spreadMs: 1000 });
      // A tenth of the room drops, then comes back, mid-round.
      await workers.all({ cmd: 'drop', count: Math.floor(initial / 10 / WORKERS) }, 'drop');
      await sleep(1500);
      const before = await workers.report();
      const t0 = performance.now();
      const back = await workers.all({ cmd: 'rejoin' });
      const rejoinMs = performance.now() - t0;
      await sleep(500);
      const afterRejoin = await workers.report();
      const roundStartsResent =
        (afterRejoin.tally.roundStarts ?? 0) - (before.tally.roundStarts ?? 0);
      const m0 = await metrics();

      // A tenth more arrive late, into a running game.
      const lateWorkers = new Workers();
      await lateWorkers.start();
      await lateWorkers.connect(origin, event.code, PLAYERS - initial);
      await sleep(500);
      const late = await lateWorkers.report();

      await host.next('round_end', 30_000);
      host.send({ type: 'host_end' });
      await host.next('game_over');
      await sleep(1000);
      const final = await workers.report();
      const finalLate = await lateWorkers.report();
      report.D = {
        players: final.open + finalLate.open,
        // Every client in a round must be told the same start instant.
        distinctStartInstants: final.startInstants.length,
        distinctPreviewsInRound: final.previews.length,
        deadSongSkippedAndHostTold:
          !!skippedDead || host.frames.some((f) => f.type === 'song_skipped'),
        rejoined: back.reduce((a, b) => a + b.rejoined, 0),
        rejoinWallMs: Math.round(rejoinMs),
        roundStartsResentOnRejoin: roundStartsResent,
        serverCountedReconnects: m0.counters.reconnects,
        lateJoiners: late.open,
        lateJoinersGotCurrentRound: late.tally.roundStarts,
        roundStartDelivery: final.roundStartDelivery,
        errors: Object.fromEntries(
          Object.entries(final.tally).filter(([k]) => k.startsWith('error')),
        ),
      };
      console.log(report.D);
      host.close();
      workers.stop();
      lateWorkers.stop();
      await sleep(1000);
    }

    if (SCENARIOS.includes('E')) {
      console.log('E: Deezer stress');
      const calls0 = stubCalls();
      // 500 hosts' worth of the same search, at once.
      const same = await Promise.all(
        Array.from({ length: 500 }, () =>
          api.call('GET', '/api/events/songs/search?q=daft%20punk'),
        ),
      );
      const afterBurst = stubCalls() - calls0;
      await Promise.all(
        Array.from({ length: 500 }, () =>
          api.call('GET', '/api/events/songs/search?q=daft%20punk'),
        ),
      );
      const afterCached = stubCalls() - calls0;
      // Many distinct searches: the budget must hold even when nothing can be shared.
      const distinct0 = stubCalls();
      const t0 = performance.now();
      await Promise.all(
        Array.from({ length: 60 }, (_, i) =>
          api.call('GET', `/api/events/songs/search?q=artist${i}`),
        ),
      );
      const distinctSeconds = (performance.now() - t0) / 1000;
      const distinctCalls = stubCalls() - distinct0;

      // Deezer goes away. Cached search still answers, an unseen one comes back empty, nothing dies.
      writeFileSync(failFile, 'down');
      const stale = await api.call('GET', '/api/events/songs/search?q=daft%20punk');
      const t1 = performance.now();
      const unseen = await Promise.all(
        Array.from({ length: 12 }, (_, i) =>
          api.call('GET', `/api/events/songs/search?q=outage${i}`),
        ),
      );
      const outageMs = performance.now() - t1;
      const breakerMetrics = await metrics();
      const callsDuring0 = stubCalls();
      await Promise.all(
        Array.from({ length: 40 }, (_, i) =>
          api.call('GET', `/api/events/songs/search?q=held${i}`),
        ),
      );
      const callsWhileOpen = stubCalls() - callsDuring0;

      // A game in progress during an outage carries on with what is cached.
      const event = await makeEvent('Scenario E outage', 'everyone_plays', 2);
      const host = await hostFor(event);
      const workers = new Workers();
      await workers.start();
      await workers.connect(origin, event.code, 50);
      await sleep(300);
      host.send({ type: 'start_game' });
      const over = await host.next('game_over', 30_000).then(
        () => true,
        () => false,
      );
      host.close();
      workers.stop();
      rmSync(failFile, { force: true });
      const healthyAfter = await fetch(`${origin}/api/health`).then((r) => r.ok);
      const m = await metrics();

      report.E = {
        identicalSearches: same.length,
        deezerCallsForBurst: afterBurst,
        deezerCallsAfter500More: afterCached,
        requestReductionPct: Math.round((1 - afterCached / 1000) * 1000) / 10,
        distinctSearches: 60,
        distinctCalls,
        distinctSeconds: Math.round(distinctSeconds * 10) / 10,
        peakRatePer5s: Math.round((distinctCalls / distinctSeconds) * 5),
        staleServedInOutage: stale.results.length,
        unseenSearchesEmptyNotError: unseen.every((u) => u.results.length === 0),
        unseenOutageWallMs: Math.round(outageMs),
        deezerCallsWhileBreakerOpen: callsWhileOpen,
        breakerOpens: breakerMetrics.counters.deezerBreakerOpens,
        gameFinishedDuringOutage: over,
        serverHealthyAfter: healthyAfter,
        searchCache: m.deezer.searchCache,
        previewCache: m.deezer.previewCache,
        coalesced: m.counters.deezerCoalesced,
      };
      console.log(report.E);
    }

    if (SCENARIOS.includes('F')) {
      console.log(`F: ${PLAYERS} connections for ${SOAK_MINUTES} minutes, continuous rounds`);
      const rounds = Math.ceil((SOAK_MINUTES * 60) / 8);
      const event = await makeEvent('Scenario F', 'everyone_plays', Math.min(rounds, 200));
      const host = await hostFor(event);
      const workers = new Workers();
      await workers.start();
      await workers.connect(origin, event.code, PLAYERS);
      await sleep(2000);
      host.send({ type: 'start_game' });
      const series: {
        minute: number;
        rssMb: number;
        heapMb: number;
        lagP99: number;
        dbP95: number;
        cpuPct: number;
      }[] = [];
      const until = Date.now() + SOAK_MINUTES * 60_000;
      let lastCpu = usage(pid);
      let lastCpuAt = Date.now();
      let nextSample = Date.now() + 60_000;
      let games = 1;
      let frame = 0;
      while (Date.now() < until) {
        const hr = await host.next('host_round', 60_000).catch(() => null);
        if (!hr) break;
        frame += 1;
        await sleep(Math.max(0, hr.playAt - Date.now()) + 100);
        await workers.all({ cmd: 'guess', pick: 'first', spreadMs: 2000 });
        await host.next('round_end', 30_000).catch(() => null);
        await sleep(500);
        if (Date.now() >= nextSample) {
          const m = await metrics();
          const u = usage(pid);
          series.push({
            minute: series.length + 1,
            rssMb: u.rssMb,
            heapMb: Math.round(m.memoryMb.heapUsed),
            lagP99: Math.round(m.eventLoopLagMs.p99),
            dbP95: Math.round(m.dbPingMs.p95 * 10) / 10,
            cpuPct: Math.round(((u.cpuMs - lastCpu.cpuMs) / (Date.now() - lastCpuAt)) * 100),
          });
          console.log(series.at(-1));
          lastCpu = u;
          lastCpuAt = Date.now();
          nextSample += 60_000;
          writeFileSync(path.join(tmp, 'soak.json'), JSON.stringify(series));
        }
        host.send({ type: 'host_skip' });
      }
      const end = await workers.report();
      const half = Math.floor(series.length / 2);
      const heapAvg = (xs: typeof series) =>
        xs.reduce((a, b) => a + b.heapMb, 0) / Math.max(1, xs.length);
      report.F = {
        minutes: series.length,
        roundsPlayed: frame,
        games,
        connectionsAtEnd: end.open,
        unexpectedCloses: Object.fromEntries(
          Object.entries(end.tally).filter(([k]) => k.startsWith('close')),
        ),
        heapMbFirstHalfAvg: Math.round(heapAvg(series.slice(0, half))),
        heapMbSecondHalfAvg: Math.round(heapAvg(series.slice(half))),
        rssStartEnd: [series[0]?.rssMb, series.at(-1)?.rssMb],
        lagP99Max: Math.max(0, ...series.map((s) => s.lagP99)),
        dbP95Max: Math.max(0, ...series.map((s) => s.dbP95)),
        cpuPctAvg: Math.round(
          series.reduce((a, b) => a + b.cpuPct, 0) / Math.max(1, series.length),
        ),
        series,
      };
      console.log({ ...(report.F as object), series: undefined });
      host.close();
      workers.stop();
    }
  } finally {
    report.finalServerMetrics = await metrics().catch(() => null);
    if (JSON_OUT) writeFileSync(JSON_OUT, JSON.stringify(report, null, 2));
    server.kill('SIGTERM');
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log('done');
  setTimeout(() => process.exit(0), 500);
}

if (process.argv.includes('--worker')) void worker();
else
  main().catch((err) => {
    console.error(err instanceof Error ? (err.stack ?? err.message) : err);
    process.exit(1);
  });
