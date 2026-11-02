import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  createRoom,
  registerConnection,
  unregisterConnection,
  handleClientMessage,
  __resetForTests,
  __getRoom,
  __getRoomPhase,
  __getCurrentTrack,
  __setClassicEnabled,
  MP_CHOICE_OPTIONS,
  MP_ROUND_DURATION_MS,
  MP_REVEAL_DURATION_MS,
  MP_REVEAL_POINTS,
  MP_REVEAL_SCHEDULE,
  MP_ROUNDS,
  MP_MAX_PLAYERS,
  MP_MAX_ROUNDS,
  type MpScoreEntry,
  type MpSocket,
} from '../../src/services/multiplayerService';

const deezerMocks = vi.hoisted(() => ({
  getArtistTopTracks: vi.fn(),
  getFreshPreviewUrl: vi.fn(),
}));

// The catalog service is mocked rather than exercised: it reads the Postgres-backed pool, and
// a real database round trip cannot resolve inside these fake-timer driven round-flow tests.
// Its own caching behaviour is covered in artistCatalogService.test.ts.
const catalogMocks = vi.hoisted(() => ({
  getArtistCatalog: vi.fn(),
}));

// Settings are read from Postgres when a room is created. Same reason as the catalog mock: a
// real database round trip cannot resolve while these tests hold fake timers, so the room would
// never finish being created and every test would sit until its timeout.
const settingsMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
}));

vi.mock('../../src/services/deezerService', () => deezerMocks);
vi.mock('../../src/services/artistCatalogService', () => catalogMocks);
vi.mock('../../src/services/settingsService', () => settingsMocks);

interface SentMessage {
  type: string;
  selfId: string;
  [key: string]: unknown;
}

class FakeSocket implements MpSocket {
  readonly sent: SentMessage[] = [];
  closed = false;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as SentMessage);
  }

  close(): void {
    this.closed = true;
  }
}

/** The room's song source. Artist-shaped, since that is what these tests race over. */
function queenSource(pictureUrl: string | null = null) {
  return {
    sourceType: 'artist' as const,
    sourceId: '412',
    label: 'Queen',
    pictureUrl,
    includeFeatures: false,
    answerIsTitle: false,
    loadCatalog: () =>
      catalogMocks.getArtistCatalog(412, false) as Promise<ReturnType<typeof mockTracks>>,
  };
}

/** A category room. The point of the source refactor: same game, different pool. */
function categorySource() {
  return {
    sourceType: 'category' as const,
    sourceId: 'year-2020',
    label: 'Top Hits 2020',
    pictureUrl: null,
    includeFeatures: false,
    answerIsTitle: false,
    loadCatalog: () => Promise.resolve(mockTracks(MP_ROUNDS * 2)),
  };
}

function mockTracks(n: number) {
  return Array.from({ length: n }, (_, i) => ({
    deezerTrackId: `dz-${i}`,
    title: `Track ${i}`,
    artist: 'Queen',
    albumArtUrl: null,
    durationSeconds: 200,
  }));
}

function register(playerId: string, guestId: string): FakeSocket {
  const socket = new FakeSocket();
  registerConnection({ playerId, socket, identity: { userId: null, guestId } });
  return socket;
}

function messagesOf(socket: FakeSocket, type: string): SentMessage[] {
  return socket.sent.filter((m) => m.type === type);
}

function lastOf(socket: FakeSocket, type: string): SentMessage | undefined {
  const matches = messagesOf(socket, type);
  return matches[matches.length - 1];
}

async function join(playerId: string, code: string, nickname?: string): Promise<void> {
  await handleClientMessage(playerId, {
    type: 'join_room',
    code,
    nickname: nickname ?? `Player ${playerId}`,
  });
}

function guess(playerId: string, trackId: string): void {
  handleClientMessage(playerId, { type: 'guess', trackId });
}

function guessCorrect(playerId: string, code: string): void {
  const track = __getCurrentTrack(code);
  if (!track) throw new Error('No current track to guess');
  guess(playerId, track.deezerTrackId);
}

function guessWrong(playerId: string): void {
  guess(playerId, 'dz-wrong');
}

function reveal(playerId: string, times = 1): void {
  for (let i = 0; i < times; i += 1) {
    handleClientMessage(playerId, { type: 'reveal' });
  }
}

beforeEach(() => {
  __resetForTests();
  vi.useFakeTimers();
  vi.clearAllMocks();
  // The shipped defaults, so the constants exported alongside them stay the right expectations.
  settingsMocks.getSettings.mockResolvedValue({
    challengeRounds: 10,
    snippetScheduleSeconds: [...MP_REVEAL_SCHEDULE],
    multiplayerRounds: MP_ROUNDS,
    multiplayerRoundSeconds: MP_ROUND_DURATION_MS / 1000,
    multiplayerRevealSeconds: MP_REVEAL_DURATION_MS / 1000,
    multiplayerMaxPlayers: MP_MAX_PLAYERS,
    speedMaxPoints: 100,
    speedMinPoints: 20,
    speedPoints: [15, 10, 5],
    speedRoundDurationSeconds: 15,
    speedSnippetSeconds: 30,
    dailyCuratedOnly: true,
    artistPoolRetentionDays: 30,
    categoryPoolRefreshHours: 24,
    abandonedChallengeTtlDays: 7,
  });
  // At least MP_ROUNDS * 2, because startGame draws that many candidates and needs MP_ROUNDS
  // of them to have a playable preview. When the round count went from 5 to 10 this pool was
  // left at 5, so every start failed with "not enough playable tracks" and nine tests broke.
  catalogMocks.getArtistCatalog.mockResolvedValue(mockTracks(MP_ROUNDS * 2));
  deezerMocks.getFreshPreviewUrl.mockImplementation(async (id: string) => ({
    previewUrl: `https://preview.test/${id}.mp3`,
    durationSeconds: 30,
  }));
  // Classic is switched off in production but its code is deliberately kept (see
  // isClassicEnabled). These tests are what stop it rotting while it's dormant, so they run
  // with it on — the default-off behaviour has its own test below.
  __setClassicEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
  __setClassicEnabled(false);
  __resetForTests();
});

describe('multiplayerService lobby', () => {
  it('creates a room with a short, unambiguous code', async () => {
    const { code } = await createRoom(queenSource());
    expect(code).toMatch(/^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{6}$/);
    expect(__getRoom(code)).toMatchObject({
      code,
      sourceType: 'artist',
      sourceId: '412',
      label: 'Queen',
      phase: 'lobby',
    });
  });

  it('joins players into a room and assigns the first joiner as host', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('p1', 'aaaabbbb');
    register('p2', 'ccccdddd');
    await join('p1', code, 'Alex');
    await join('p2', code);

    const hostState = lastOf(host, 'room_state')!.room as {
      phase: string;
      players: Array<{ playerId: string; isHost: boolean; displayName: string }>;
    };
    expect(hostState.phase).toBe('lobby');
    expect(hostState.players).toHaveLength(2);
    expect(hostState.players.map((p) => p.playerId).sort()).toEqual(['p1', 'p2']);
    expect(hostState.players.find((p) => p.playerId === 'p1')!.isHost).toBe(true);
    expect(hostState.players.find((p) => p.playerId === 'p2')!.isHost).toBe(false);
    expect(hostState.players.find((p) => p.playerId === 'p1')!.displayName).toBe('Alex');
  });

  it('rejects a join with an unknown room code', async () => {
    const socket = register('p1', 'aaaabbbb');
    await join('p1', 'ZZZZZZ');
    const error = lastOf(socket, 'error');
    expect(error?.message).toContain('Room not found');
  });

  it('rejects a join when the room is full', async () => {
    const { code } = await createRoom(queenSource());
    for (let i = 0; i < MP_MAX_PLAYERS; i += 1) {
      register(`p${i}`, `guest${i}`.padEnd(10, '0'));
      await join(`p${i}`, code);
    }
    const extra = register('overflow', 'overflow00');
    await join('overflow', code);
    expect(lastOf(extra, 'error')?.message).toContain('Room is full');
  });

  it('rejects a join once the game is in progress', async () => {
    const { code } = await createRoom(queenSource());
    register('host', 'hostaaaa');
    await join('host', code);
    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    const late = register('late', 'latebbbb');
    await join('late', code);
    expect(lastOf(late, 'error')?.message).toContain('already in progress');
  });

  it('reassigns host when the host leaves, and destroys the room when it empties', async () => {
    const { code } = await createRoom(queenSource());
    register('p1', 'aaaabbbb');
    register('p2', 'ccccdddd');
    await join('p1', code);
    const guest = register('p3', 'eeeeffff');
    await join('p2', code);
    await join('p3', code);

    handleClientMessage('p1', { type: 'leave_room' });
    let state = lastOf(guest, 'room_state')!.room as {
      hostId: string;
      players: Array<{ playerId: string }>;
    };
    expect(state.hostId).toBe('p2');
    expect(state.players).toHaveLength(2);

    handleClientMessage('p2', { type: 'leave_room' });
    handleClientMessage('p3', { type: 'leave_room' });
    expect(__getRoom(code)).toBeNull();
  });
});

describe('multiplayerService start_game', () => {
  it('only lets the host start the game', async () => {
    const { code } = await createRoom(queenSource());
    register('host', 'hostaaaa');
    const guest = register('guest', 'guestbbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('guest', { type: 'start_game' });
    expect(lastOf(guest, 'error')?.message).toContain('Only the host');

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    expect(messagesOf(guest, 'round_start')).toHaveLength(1);
  });

  it('refuses to start when the artist has nothing playable', async () => {
    catalogMocks.getArtistCatalog.mockResolvedValue([]);
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    await join('host', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    // Wording changed with short runs: the message now names the catalogue size, because
    // "not enough playable tracks" read as a fault in the game rather than a fact about
    // the artist.
    expect(lastOf(host, 'error')?.message).toContain('not enough for a game');
    expect(__getRoomPhase(code)).toBe('lobby');
  });
});

describe('multiplayerService round flow', () => {
  it('lets each player reveal audio manually and awards points by reveal count', async () => {
    const { code } = await createRoom(queenSource('https://art.test/queen.jpg'));
    const host = register('host', 'hostaaaa');
    const guest = register('guest', 'guestbbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    const start = lastOf(guest, 'round_start');
    const firstTrack = __getCurrentTrack(code)!;
    expect(start?.roundIndex).toBe(0);
    expect(start?.totalRounds).toBe(MP_ROUNDS);
    expect(start?.roundDurationMs).toBe(MP_ROUND_DURATION_MS);
    expect(start?.previewUrl).toBe(`https://preview.test/${firstTrack.deezerTrackId}.mp3`);
    expect(start?.pictureUrl).toBe('https://art.test/queen.jpg');
    expect(__getRoomPhase(code)).toBe('playing');

    // Nothing auto-reveals — the guest reveals once and hears the second slice.
    reveal('guest');
    expect(lastOf(guest, 'stage')?.stageIndex).toBe(1);
    expect(messagesOf(guest, 'stage')).toHaveLength(1);

    // The host stays on the first slice and gets the top points; the guest's one reveal
    // costs them one point tier.
    guessCorrect('host', code);
    guessCorrect('guest', code);
    // Points are read off the revealed scores, not the guess acknowledgement: the outcome is
    // withheld until the round ends, so guess_result deliberately carries neither.
    const settled = lastOf(host, 'round_end')!.scores as MpScoreEntry[];
    expect(settled.find((s) => s.playerId === 'host')?.score).toBe(MP_REVEAL_POINTS[0]);
    expect(settled.find((s) => s.playerId === 'guest')?.score).toBe(MP_REVEAL_POINTS[1]);

    // Both players answered -> round ends early with a reveal.
    expect(__getRoomPhase(code)).toBe('round-reveal');
    const revealMsg = lastOf(guest, 'round_end');
    const revealCorrect = revealMsg?.correct as { title: string; artist: string } | undefined;
    expect(revealCorrect?.title).toBeTruthy();

    // Non-host cannot skip the reveal; the host can.
    handleClientMessage('guest', { type: 'next_round' });
    expect(lastOf(guest, 'error')?.message).toContain('Only the host');
    handleClientMessage('host', { type: 'next_round' });
    expect(lastOf(host, 'round_start')?.roundIndex).toBe(1);
  });

  it('builds the catalogue once when the host presses start twice', async () => {
    // A cold category can take tens of seconds to build, during which the lobby used to look
    // untouched — so hosts pressed start again and the whole build ran a second time.
    let loads = 0;
    let release!: (tracks: ReturnType<typeof mockTracks>) => void;
    const pending = new Promise<ReturnType<typeof mockTracks>>((resolve) => {
      release = resolve;
    });

    const { code } = await createRoom({
      ...categorySource(),
      loadCatalog: () => {
        loads += 1;
        return pending;
      },
    });
    const host = register('host', 'hostaaaa');
    await join('host', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    expect(__getRoomPhase(code)).toBe('starting');

    // The impatient second press, while the first build is still in flight.
    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    expect(loads).toBe(1);
    expect(lastOf(host, 'error')?.message).toContain('already in progress');

    release(mockTracks(MP_ROUNDS * 2));
    await vi.advanceTimersByTimeAsync(0);
    expect(__getRoomPhase(code)).toBe('playing');
  });

  it('caps reveals at the end of the snippet schedule', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    await join('host', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    reveal('host', MP_REVEAL_SCHEDULE.length - 1);
    expect(lastOf(host, 'stage')?.stageIndex).toBe(MP_REVEAL_SCHEDULE.length - 1);

    // One more reveal is ignored, and the player is still free to answer.
    reveal('host');
    expect(messagesOf(host, 'stage')).toHaveLength(MP_REVEAL_SCHEDULE.length - 1);
    guessCorrect('host', code);
    expect(__getRoomPhase(code)).toBe('round-reveal');
    // Scored at the bottom tier for using every reveal, read off the revealed round_end scores
    // since the guess acknowledgement no longer carries the outcome.
    const scored = lastOf(host, 'round_end')!.scores as MpScoreEntry[];
    expect(scored.find((s) => s.playerId === 'host')?.score).toBe(
      MP_REVEAL_POINTS[MP_REVEAL_SCHEDULE.length - 1],
    );
  });

  it('ends the round when the time limit expires even if nobody answered', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    register('guest', 'guestbbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    expect(__getRoomPhase(code)).toBe('playing');

    await vi.advanceTimersByTimeAsync(MP_ROUND_DURATION_MS);
    expect(__getRoomPhase(code)).toBe('round-reveal');
    expect(lastOf(host, 'round_end')).toBeDefined();
  });

  it('scores zero for a wrong guess and only lets players answer once', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    register('guest', 'guestbbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    guessWrong('host');
    // Acknowledged, but the acknowledgement says nothing about how it went.
    expect(lastOf(host, 'guess_result')).toBeDefined();

    // A second guess in the same round is rejected.
    guessCorrect('host', code);
    expect(lastOf(host, 'error')?.message).toContain('Already answered');

    guessCorrect('guest', code);
    expect(__getRoomPhase(code)).toBe('round-reveal');
    const settled = lastOf(host, 'round_end')!.scores as MpScoreEntry[];
    expect(settled.find((s) => s.playerId === 'host')).toMatchObject({
      correctThisRound: false,
      score: 0,
    });
  });

  it(`runs the full ${MP_ROUNDS}-round game and reports a winner`, async () => {
    const { code } = await createRoom(queenSource());
    register('host', 'hostaaaa');
    const guest = register('guest', 'guestbbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    for (let round = 0; round < MP_ROUNDS; round += 1) {
      expect(__getRoomPhase(code)).toBe('playing');
      guessCorrect('host', code);
      guessCorrect('guest', code);
      expect(__getRoomPhase(code)).toBe('round-reveal');
      await vi.advanceTimersByTimeAsync(MP_REVEAL_DURATION_MS);
    }

    expect(__getRoomPhase(code)).toBe('finished');
    const over = lastOf(guest, 'game_over');
    expect(over?.scores).toHaveLength(2);
    // Every round was solved at stage 0, so each player earns MP_ROUNDS * 6 points and
    // the tie resolves in the first player's favour.
    const scores = over?.scores as Array<{ score: number }>;
    expect(scores.every((s) => s.score === MP_ROUNDS * MP_REVEAL_POINTS[0])).toBe(true);
    const winner = over?.winner as { playerId: string } | undefined;
    expect(winner?.playerId).toBe('host');
  });

  it('cleans up connections on unregister', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    await join('host', code);
    unregisterConnection('host');
    expect(host.closed).toBe(false);
    expect(__getRoom(code)).toBeNull();
  });
});

describe('multiplayerService guess mode', () => {
  it('defaults to search mode and sends no options', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    await join('host', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    const start = lastOf(host, 'round_start');
    expect(start?.guessMode).toBe('search');
    expect(start?.options).toBeUndefined();
    expect(__getRoom(code)).toMatchObject({ guessMode: 'search' });
  });

  /*
   * A catalogue too thin for the full length plays short instead of refusing.
   *
   * K/DA and similar have a handful of songs, and the old gate meant they simply could not be
   * played — the error read like a fault in the game rather than a fact about the artist.
   */
  it('shortens the game to fit a thin catalogue', async () => {
    catalogMocks.getArtistCatalog.mockResolvedValue(mockTracks(4));
    const { code } = await createRoom(queenSource(), 'choice', 'speed', false, true, 10);
    const host = register('host', 'hostaaaa');
    await join('host', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    expect(lastOf(host, 'round_start')?.totalRounds).toBe(4);
    expect(lastOf(host, 'error')).toBeUndefined();
  });

  it('still refuses a catalogue with almost nothing in it', async () => {
    catalogMocks.getArtistCatalog.mockResolvedValue(mockTracks(2));
    const { code } = await createRoom(queenSource(), 'choice', 'speed');
    const host = register('host', 'hostaaaa');
    await join('host', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    expect(lastOf(host, 'error')?.message).toContain('not enough for a game');
  });

  it('substitutes a speed round when classic is disabled', async () => {
    __setClassicEnabled(false);
    const { code } = await createRoom(queenSource(), 'search', 'classic');
    // Speed rounds are always multiple choice, so the requested search mode goes with it.
    expect(__getRoom(code)).toMatchObject({ gameMode: 'speed', guessMode: 'choice' });
  });

  it('honours an explicit classic room while the mode is enabled', async () => {
    const { code } = await createRoom(queenSource(), 'search', 'classic');
    expect(__getRoom(code)).toMatchObject({ gameMode: 'classic', guessMode: 'search' });
  });

  it('caps a host-chosen round count at the maximum', async () => {
    const { code } = await createRoom(queenSource(), 'search', 'classic', false, true, 999);
    expect(__getRoom(code)).toMatchObject({ totalRounds: MP_MAX_ROUNDS });
  });

  it('uses a host-chosen round count when it is in range', async () => {
    const { code } = await createRoom(queenSource(), 'search', 'classic', false, true, 3);
    expect(__getRoom(code)).toMatchObject({ totalRounds: 3 });
  });

  it('sends four options per round in choice mode', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const host = register('host', 'hostaaaa');
    await join('host', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    const start = lastOf(host, 'round_start');
    expect(start?.guessMode).toBe('choice');
    const options = start?.options as { deezerTrackId: string; title: string }[];
    expect(options).toHaveLength(MP_CHOICE_OPTIONS);
    // The correct answer has to be among them, or the round is unwinnable.
    const current = __getCurrentTrack(code);
    expect(options.map((o) => o.deezerTrackId)).toContain(current?.deezerTrackId);
  });

  /*
   * Regression: answering song one left the guess UI disabled for the rest of the game.
   *
   * `round_start` carries the new song but nothing about who has answered, so a client holding
   * the previous round's scores still saw everyone as answered — and the guess UI is gated on
   * exactly that. The reset has to be published, not just applied in memory.
   */
  it('publishes cleared answered flags when a new round starts', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const host = register('host', 'hostaaaa');
    register('guest', 'guestbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    // Host answers round one; the guest does not, so the round runs to time.
    const track = __getCurrentTrack(code);
    handleClientMessage('host', { type: 'guess', trackId: track!.deezerTrackId });
    expect(
      (lastOf(host, 'scores')?.scores as { playerId: string; answered: boolean }[]).find(
        (s) => s.playerId === 'host',
      )?.answered,
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(MP_ROUND_DURATION_MS + MP_REVEAL_DURATION_MS);

    // Round two is live, and the last scores frame must say the host may answer again.
    expect(lastOf(host, 'round_start')?.roundIndex).toBe(1);
    const scores = lastOf(host, 'scores')?.scores as { playerId: string; answered: boolean }[];
    expect(scores.find((s) => s.playerId === 'host')?.answered).toBe(false);
    expect(scores.find((s) => s.playerId === 'guest')?.answered).toBe(false);
  });

  /*
   * Speed scoring is time-first, order-second.
   *
   * Order alone made the round a race to click rather than a race to know: answering at one
   * second and at fourteen paid the same as long as nobody beat you to it.
   */
  describe('speed scoring', () => {
    async function speedRoom() {
      const { code } = await createRoom(queenSource(), 'choice', 'speed');
      const host = register('host', 'hostaaaa');
      const guest = register('guest', 'guestbbb');
      await join('host', code);
      await join('guest', code);
      handleClientMessage('host', { type: 'start_game' });
      await vi.advanceTimersByTimeAsync(0);
      return { code, host, guest };
    }

    function scoreOf(socket: FakeSocket, playerId: string): number {
      const scores = lastOf(socket, 'round_end')!.scores as MpScoreEntry[];
      return scores.find((s) => s.playerId === playerId)!.score;
    }

    it('pays an instant answer more than a slow one', async () => {
      const fast = await speedRoom();
      guessCorrect('host', fast.code);
      await vi.advanceTimersByTimeAsync(60_000);
      const fastScore = scoreOf(fast.host, 'host');

      __resetForTests();
      const slow = await speedRoom();
      // Most of the round gone before answering.
      await vi.advanceTimersByTimeAsync(12_000);
      guessCorrect('host', slow.code);
      await vi.advanceTimersByTimeAsync(60_000);
      const slowScore = scoreOf(slow.host, 'host');

      expect(fastScore).toBeGreaterThan(slowScore);
      // Still worth something — being right late beats being wrong.
      expect(slowScore).toBeGreaterThan(0);
    });

    it('adds a bonus for answering first, on top of the time score', async () => {
      const { code, host } = await speedRoom();
      // Both answer at the same instant, so only the order bonus can separate them.
      guessCorrect('host', code);
      guessCorrect('guest', code);
      await vi.advanceTimersByTimeAsync(60_000);

      expect(scoreOf(host, 'host')).toBeGreaterThan(scoreOf(host, 'guest'));
    });

    it('records how long each answer took, for the tie breaker', async () => {
      const { code, host } = await speedRoom();
      await vi.advanceTimersByTimeAsync(4_000);
      guessCorrect('host', code);
      await vi.advanceTimersByTimeAsync(60_000);

      const scores = lastOf(host, 'round_end')!.scores as MpScoreEntry[];
      const mine = scores.find((s) => s.playerId === 'host')!;
      expect(mine.totalAnswerMs).toBeGreaterThanOrEqual(4_000);
    });

    it('orders a tied scoreboard by who answered faster overall', async () => {
      const { host } = await speedRoom();
      // Guest answers wrong immediately, host wrong much later: same score, different times.
      guessWrong('guest');
      await vi.advanceTimersByTimeAsync(9_000);
      guessWrong('host');
      await vi.advanceTimersByTimeAsync(60_000);

      const scores = lastOf(host, 'round_end')!.scores as MpScoreEntry[];
      expect(scores[0]!.score).toBe(scores[1]!.score);
      expect(scores[0]!.playerId).toBe('guest');
    });
  });

  /*
   * The outcome of a guess is withheld until the reveal, so the round keeps its suspense and
   * nobody can read the answer off a neighbour's screen. Three separate channels would leak it,
   * so all three are pinned here.
   */
  it('does not tell a player whether their guess was right', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const host = register('host', 'hostaaaa');
    register('guest', 'guestbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    guessCorrect('host', code);

    const result = lastOf(host, 'guess_result')!;
    expect(result.guessedTrackId).toBeDefined();
    expect(result.correct).toBeUndefined();
    expect(result.points).toBeUndefined();
  });

  it('hides the outcome and the score change from the scoreboard mid-round', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const host = register('host', 'hostaaaa');
    register('guest', 'guestbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    guessCorrect('host', code);

    const mid = (lastOf(host, 'scores')!.scores as MpScoreEntry[]).find(
      (s) => s.playerId === 'host',
    )!;
    // Answered is honest — that much is part of the tension — but not how it went.
    expect(mid.answered).toBe(true);
    expect(mid.correctThisRound).toBeNull();
    // A total that jumps the moment someone answers announces the result just as loudly.
    expect(mid.score).toBe(0);
  });

  it('reveals the outcome and the real score when the round ends', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const host = register('host', 'hostaaaa');
    register('guest', 'guestbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    guessCorrect('host', code);
    await vi.advanceTimersByTimeAsync(MP_ROUND_DURATION_MS);

    const revealed = (lastOf(host, 'round_end')!.scores as MpScoreEntry[]).find(
      (s) => s.playerId === 'host',
    )!;
    expect(revealed.correctThisRound).toBe(true);
    expect(revealed.score).toBeGreaterThan(0);
  });

  /* Passes with or without the broadcast above — the server always accepted these. Kept as the
     other half of the picture: it pins down that the round-two lockout was purely a matter of
     what clients were told, so anyone debugging a repeat starts on the right side of the wire. */
  it('has always accepted a guess on a later round after answering the first', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const host = register('host', 'hostaaaa');
    register('guest', 'guestbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    handleClientMessage('host', { type: 'guess', trackId: __getCurrentTrack(code)!.deezerTrackId });
    await vi.advanceTimersByTimeAsync(MP_ROUND_DURATION_MS + MP_REVEAL_DURATION_MS);

    const before = messagesOf(host, 'guess_result').length;
    handleClientMessage('host', { type: 'guess', trackId: __getCurrentTrack(code)!.deezerTrackId });

    expect(messagesOf(host, 'guess_result')).toHaveLength(before + 1);
    expect(lastOf(host, 'error')).toBeUndefined();
  });

  it('gives every player the same options, arranged differently', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const host = register('host', 'hostaaaa');
    const guest = register('guest', 'guestbbb');
    await join('host', code);
    await join('guest', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    const ids = (sock: FakeSocket) =>
      ((lastOf(sock, 'round_start')?.options ?? []) as { deezerTrackId: string }[]).map(
        (o) => o.deezerTrackId,
      );
    const hostIds = ids(host);
    const guestIds = ids(guest);

    expect(hostIds.length).toBeGreaterThan(1);
    // A race is only fair if both players are choosing between the same answers...
    expect([...guestIds].sort()).toEqual([...hostIds].sort());
    /*
     * ...but not the same *arrangement*. A shared order turns the game into "watch the person
     * next to you": one player answering fast tells the rest which position to tap, and on a
     * phone that beats recognising the song.
     *
     * Asserted on these two seeds specifically rather than looping until they differ — the
     * shuffle is seeded on player and round, so this pair is deterministic, and a loop would
     * hide the day it stops permuting.
     */
    expect(guestIds).not.toEqual(hostIds);
  });

  it('carries the mode on the room snapshot so joiners see it in the lobby', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const guest = register('guest', 'guestbbb');
    await join('guest', code);

    const state = lastOf(guest, 'room_state')?.room as { guessMode: string };
    expect(state.guessMode).toBe('choice');
  });
});

describe('changing what a finished room races over', () => {
  /** Plays a room to completion so the source switch has a realistic starting state. */
  async function playToFinish(code: string, socket: FakeSocket) {
    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    for (let i = 0; i < MP_ROUNDS; i++) {
      await vi.advanceTimersByTimeAsync(MP_ROUND_DURATION_MS + MP_REVEAL_DURATION_MS);
    }
    expect(lastOf(socket, 'game_over')).toBeDefined();
    expect(__getRoomPhase(code)).toBe('finished');
  }

  it('repoints a finished room at a category and returns it to the lobby', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    await join('host', code);
    await playToFinish(code, host);

    await handleClientMessage('host', { type: 'change_source', categoryId: 'year-2020' });

    expect(__getRoom(code)).toMatchObject({
      code,
      sourceType: 'category',
      sourceId: 'year-2020',
      phase: 'lobby',
    });
  });

  it('keeps every player in the room across the switch', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    const guest = register('guest', 'guestaaa');
    await join('host', code);
    await join('guest', code);
    await playToFinish(code, host);

    await handleClientMessage('host', { type: 'change_source', categoryId: 'year-2020' });

    const room = __getRoom(code);
    expect(room?.players).toHaveLength(2);
    expect(room?.hostId).toBe('host');
    // The guest is told about it rather than being left staring at the old results.
    expect(lastOf(guest, 'room_state')?.room).toMatchObject({ sourceId: 'year-2020' });
  });

  it('resets scores, so the new race does not start with someone already ahead', async () => {
    const { code } = await createRoom(queenSource());
    register('host', 'hostaaaa');
    await join('host', code);

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);
    const track = __getCurrentTrack(code);
    handleClientMessage('host', { type: 'guess', trackId: track!.deezerTrackId });
    await vi.advanceTimersByTimeAsync(MP_REVEAL_DURATION_MS);
    for (let i = 0; i < MP_ROUNDS; i++) {
      await vi.advanceTimersByTimeAsync(MP_ROUND_DURATION_MS + MP_REVEAL_DURATION_MS);
    }
    expect(__getRoom(code)?.players[0]?.score).toBeGreaterThan(0);

    await handleClientMessage('host', { type: 'change_source', categoryId: 'year-2020' });
    expect(__getRoom(code)?.players[0]?.score).toBe(0);
  });

  it('lets only the host change the music', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    const guest = register('guest', 'guestaaa');
    await join('host', code);
    await join('guest', code);
    await playToFinish(code, host);

    await handleClientMessage('guest', { type: 'change_source', categoryId: 'year-2020' });

    expect(lastOf(guest, 'error')?.message).toMatch(/only the host/i);
    expect(__getRoom(code)).toMatchObject({ sourceId: '412' });
  });

  it('refuses to swap the source out from under a game in progress', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    await join('host', code);
    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    await handleClientMessage('host', { type: 'change_source', categoryId: 'year-2020' });

    expect(lastOf(host, 'error')?.message).toMatch(/finish the current game/i);
    expect(__getRoom(code)).toMatchObject({ sourceId: '412', phase: 'playing' });
  });

  it('rejects a request naming both an artist and a category', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    await join('host', code);
    await playToFinish(code, host);

    await handleClientMessage('host', {
      type: 'change_source',
      artistId: 412,
      categoryId: 'year-2020',
    });

    expect(lastOf(host, 'error')?.message).toMatch(/exactly one/i);
    expect(__getRoom(code)).toMatchObject({ sourceId: '412' });
  });

  it('reports an unknown category instead of emptying the room', async () => {
    const { code } = await createRoom(queenSource());
    const host = register('host', 'hostaaaa');
    await join('host', code);
    await playToFinish(code, host);

    await handleClientMessage('host', { type: 'change_source', categoryId: 'not-a-category' });

    expect(lastOf(host, 'error')?.message).toMatch(/unknown category/i);
    expect(__getRoom(code)).toMatchObject({ sourceId: '412', phase: 'finished' });
  });
});

describe('rooms over a category', () => {
  it('races over a category with the same rules as an artist room', async () => {
    const { code } = await createRoom(categorySource());
    const host = register('host', 'hostaaaa');
    await join('host', code);

    expect(__getRoom(code)).toMatchObject({
      sourceType: 'category',
      sourceId: 'year-2020',
      label: 'Top Hits 2020',
      phase: 'lobby',
    });

    handleClientMessage('host', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    // A category room deals rounds from its own pool, not an artist catalog.
    expect(catalogMocks.getArtistCatalog).not.toHaveBeenCalled();
    expect(lastOf(host, 'round_start')).toBeDefined();
    expect(__getRoomPhase(code)).toBe('playing');
  });

  it('carries the label onto the snapshot so joiners see what they are racing over', async () => {
    const { code } = await createRoom(categorySource());
    const guest = register('guest', 'guestaaa');
    await join('guest', code);

    // The snapshot is nested under `room`, which is what joiners render the header from.
    const snapshot = lastOf(guest, 'room_state')?.room as { label: string } | undefined;
    expect(snapshot?.label).toBe('Top Hits 2020');
  });
});

/**
 * A streamer's room is the case these guard. Rooms live in one process, so anything that scales
 * worse than linearly with player count is a hard ceiling on how big a room can get.
 */
describe('large rooms', () => {
  it('caps how many scores a broadcast carries', async () => {
    const { code } = await createRoom(queenSource(), 'choice');
    const sockets = [];
    for (let i = 0; i < 60; i++) {
      sockets.push(register(`p${i}`, `seed${i}`.padEnd(8, 'x')));
      await join(`p${i}`, code);
    }
    handleClientMessage('p0', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    const scores = (lastOf(sockets[0]!, 'scores')?.scores ?? []) as unknown[];
    // 60 players joined; a broadcast must not carry a row for every one of them.
    expect(scores.length).toBeGreaterThan(0);
    expect(scores.length).toBeLessThanOrEqual(10);
  });

  it('sends one identical frame to every player in a broadcast', async () => {
    // The frame is shared, so it cannot carry a per-player field. selfId still arrives through
    // the individually-addressed messages, which is where the client reads it.
    const { code } = await createRoom(queenSource(), 'choice');
    const a = register('pa', 'aaaabbbb');
    const b = register('pb', 'ccccdddd');
    await join('pa', code);
    await join('pb', code);
    handleClientMessage('pa', { type: 'start_game' });
    await vi.advanceTimersByTimeAsync(0);

    const sa = lastOf(a, 'scores');
    const sb = lastOf(b, 'scores');
    expect(sa).toBeTruthy();
    expect(JSON.stringify(sa)).toEqual(JSON.stringify(sb));
  });
});
