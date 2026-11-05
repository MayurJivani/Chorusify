/**
 * Runs a whole hosted event against real WebSocket clients: an audience of guests joins, the host
 * plays the trial song, then the game, and every phone answers every round.
 *
 *   EVENT_HOST_EMAIL=… EVENT_HOST_PASSWORD=… \
 *     npx tsx apps/server/src/scripts/loadtest-event-live.ts <code> <eventId> [players] [origin]
 *
 * Checks what a host would notice in the room, not just that frames arrive: the trial's points are
 * wiped before the game, no round offers an earlier answer, covers come with the options when the
 * event asks for them, and every phone gets the final result. Exits non-zero if any check fails.
 *
 * Unlike loadtest-event.ts, which boots its own server with Deezer stubbed to measure capacity,
 * this drives an event you created on a running server, with real previews. Points at a local
 * server by default, for the same reason as loadtest-room.
 */
import { WebSocket } from 'ws';

const [CODE, EVENT_ID] = [process.argv[2], process.argv[3]];
const PLAYERS = Number(process.argv[4] ?? 500);
const ORIGIN = process.argv[5] ?? 'http://127.0.0.1:8888';
const WS_URL = ORIGIN.replace(/^http/, 'ws') + '/ws';
const CONNECT_BATCH = 100;

type Frame = Record<string, any>;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (xs: number[], p: number) =>
  xs.length ? xs.slice().sort((a, b) => a - b)[Math.floor((xs.length - 1) * p)]! : 0;
const failures: string[] = [];
const check = (ok: boolean, what: string) => {
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${what}`);
  if (!ok) failures.push(what);
};

function cookiesOf(res: Response): string[] {
  return (res.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]!);
}

async function guestSession(): Promise<string> {
  return cookiesOf(await fetch(`${ORIGIN}/api/categories`)).join('; ');
}

async function hostSession(): Promise<string> {
  const jar = cookiesOf(await fetch(`${ORIGIN}/api/categories`));
  const csrf = jar
    .find((c) => c.includes('csrf'))!
    .split('=')
    .slice(1)
    .join('=');
  const res = await fetch(`${ORIGIN}/api/auth/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: jar.join('; '),
      'x-csrf-token': csrf,
      Origin: ORIGIN,
    },
    body: JSON.stringify({
      email: process.env.EVENT_HOST_EMAIL,
      password: process.env.EVENT_HOST_PASSWORD,
    }),
  });
  if (!res.ok) throw new Error(`Host login failed: ${res.status}`);
  const fresh = cookiesOf(res);
  const names = new Set(fresh.map((c) => c.split('=')[0]));
  return [...jar.filter((c) => !names.has(c.split('=')[0])), ...fresh].join('; ');
}

function open(cookie: string, onFrame: (f: Frame) => void): Promise<WebSocket> {
  const ws = new WebSocket(WS_URL, { headers: { Cookie: cookie, Origin: ORIGIN } });
  ws.on('message', (data) => onFrame(JSON.parse(data.toString()) as Frame));
  return new Promise((resolve, reject) => {
    ws.once('open', () => resolve(ws));
    ws.once('error', reject);
  });
}

interface Bot {
  ws: WebSocket;
  roundStarts: { at: number; frame: Frame }[];
  results: number[];
  lastScore: number | null;
  gameOver: Frame | null;
  pendingGuessAt: number;
}

async function main() {
  if (!CODE || !EVENT_ID)
    throw new Error('Usage: loadtest-event-live.ts <code> <eventId> [players]');
  console.log(`Event ${CODE}: ${PLAYERS} players at ${ORIGIN}\n`);

  const hostFrames: Frame[] = [];
  const host = await open(await hostSession(), (f) => hostFrames.push(f));
  host.send(JSON.stringify({ type: 'host_event', eventId: EVENT_ID, code: CODE }));
  await sleep(500);
  const send = (type: string) => host.send(JSON.stringify({ type }));

  const bots: Bot[] = [];
  const joinMs: number[] = [];
  for (let i = 0; i < PLAYERS; i += CONNECT_BATCH) {
    const batch = await Promise.allSettled(
      Array.from({ length: Math.min(CONNECT_BATCH, PLAYERS - i) }, async (_, k) => {
        const t0 = performance.now();
        const bot: Bot = {
          ws: null as unknown as WebSocket,
          roundStarts: [],
          results: [],
          lastScore: null,
          gameOver: null,
          pendingGuessAt: 0,
        };
        bot.ws = await open(await guestSession(), (f) => {
          if (f.type === 'round_start') {
            bot.roundStarts.push({ at: performance.now(), frame: f });
            // A person reads the four options and taps one, somewhere in the first few seconds.
            const wait = Math.max(0, f.startedAt - f.serverNow) + 300 + Math.random() * 4000;
            const pick = f.options[Math.floor(Math.random() * f.options.length)];
            setTimeout(() => {
              bot.pendingGuessAt = performance.now();
              bot.ws.send(JSON.stringify({ type: 'guess', trackId: pick.deezerTrackId }));
            }, wait);
          }
          if (f.type === 'guess_result' && bot.pendingGuessAt) {
            bot.results.push(performance.now() - bot.pendingGuessAt);
            bot.pendingGuessAt = 0;
          }
          if (f.type === 'standing') bot.lastScore = f.score;
          if (f.type === 'game_over') bot.gameOver = f;
        });
        bot.ws.send(JSON.stringify({ type: 'join_room', code: CODE, nickname: `Bot ${i + k}` }));
        joinMs.push(performance.now() - t0);
        return bot;
      }),
    );
    for (const r of batch) if (r.status === 'fulfilled') bots.push(r.value);
    process.stdout.write(`\r  joined ${bots.length}/${PLAYERS}`);
    await sleep(40);
  }
  await sleep(1500);
  const lastState = () => hostFrames.filter((f) => f.type === 'room_state').at(-1)?.room;
  console.log(
    `\n  join p50 ${pct(joinMs, 0.5).toFixed(0)}ms · p99 ${pct(joinMs, 0.99).toFixed(0)}ms\n`,
  );
  check(lastState()?.playerCount === PLAYERS, `host sees ${lastState()?.playerCount} players`);
  check(lastState()?.trialPending === true, 'trial song is waiting to be played');

  // --- Trial ---
  const roundEnds = () => hostFrames.filter((f) => f.type === 'round_end').length;
  send('start_game');
  const trialAt = performance.now();
  while (lastState()?.phase !== 'lobby' || roundEnds() === 0) {
    if (performance.now() - trialAt > 120_000) throw new Error('Trial never finished');
    await sleep(250);
  }
  await sleep(1000);
  const trialRound = bots.filter((b) => b.roundStarts.length === 1).length;
  check(trialRound === bots.length, `${trialRound}/${bots.length} phones got the trial round`);
  const trialEnd = hostFrames.find((f) => f.type === 'round_end')!;
  check(
    (trialEnd.scores ?? []).some((s: Frame) => s.score > 0),
    'someone scored in the trial',
  );
  const state = lastState();
  check(
    state.trialPending === false && state.isTrial === false,
    'room is back in the lobby, trial done',
  );
  const scoresAfter = hostFrames.filter((f) => f.type === 'scores').at(-1)?.scores ?? [];
  check(
    scoresAfter.length > 0 && scoresAfter.every((s: Frame) => s.score === 0),
    'every score is back to zero after the trial',
  );
  check(
    hostFrames.every((f) => f.type !== 'game_over') && bots.every((b) => !b.gameOver),
    'the trial did not end the event',
  );

  // --- The game ---
  const hostRoundsBefore = hostFrames.filter((f) => f.type === 'host_round').length;
  send('start_game');
  const gameAt = performance.now();
  while (!bots.every((b) => b.gameOver)) {
    if (performance.now() - gameAt > 15 * 60_000) break;
    await sleep(500);
  }
  const rounds = hostFrames.filter((f) => f.type === 'host_round').slice(hostRoundsBefore);
  const answers = rounds.map((r) => r.title as string);
  console.log(`\n  played ${rounds.length} rounds: ${answers.join(' / ')}`);
  check(
    bots.every((b) => b.gameOver),
    `${bots.filter((b) => b.gameOver).length} phones got the result`,
  );

  // Fanout per round: how far apart the phones received the same round_start.
  for (let r = 1; r <= rounds.length; r += 1) {
    const at = bots.map((b) => b.roundStarts[r]?.at).filter((x): x is number => x != null);
    const spread = at.length ? Math.max(...at) - Math.min(...at) : -1;
    console.log(`  round ${r}: ${at.length} phones, arrival spread ${spread.toFixed(0)}ms`);
  }
  const guessMs = bots.flatMap((b) => b.results);
  console.log(
    `  guess answered p50 ${pct(guessMs, 0.5).toFixed(0)}ms · p99 ${pct(guessMs, 0.99).toFixed(0)}ms (${guessMs.length} guesses)`,
  );

  const sample = bots[0]!.roundStarts.slice(1).map((s) => s.frame);
  const repeats = sample.flatMap((f, i) =>
    f.options
      .filter((o: Frame) => answers.slice(0, i).includes(o.title))
      .map((o: Frame) => o.title),
  );
  check(
    repeats.length === 0,
    `no round offers an earlier answer${repeats.length ? `: ${repeats}` : ''}`,
  );
  check(
    sample.every(
      (f) => f.options.length === 4 && f.options.every((o: Frame) => 'albumArtUrl' in o),
    ),
    'every round has four options with covers',
  );
  const sameOptions = bots.every((b) =>
    b.roundStarts.slice(1).every((s, i) => {
      const ids = (f: Frame) =>
        f.options
          .map((o: Frame) => o.deezerTrackId)
          .sort()
          .join();
      return ids(s.frame) === ids(sample[i]!);
    }),
  );
  check(sameOptions, 'every phone was offered the same four answers');

  const stored = await fetch(`${ORIGIN}/api/events/${EVENT_ID}`, {
    headers: { Cookie: await hostSession() },
  }).then((r) => r.json() as Promise<{ event: Frame }>);
  check(stored.event.status === 'ended', `event stored as ${stored.event.status}`);
  check(
    (stored.event.results?.length ?? 0) > 0 && stored.event.playerCount === PLAYERS,
    `result saved for ${stored.event.playerCount} players`,
  );

  for (const b of bots) b.ws.close();
  host.close();
  console.log(failures.length ? `\n${failures.length} check(s) failed` : '\nAll checks passed');
  process.exit(failures.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
